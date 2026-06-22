from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd
import shutil
import os
import sys
import re

# Ensure UTF-8 output encoding to prevent UnicodeEncodeError on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from parsers.base_parser import clean_bank_csv
from recurring import detect_recurring_expenses, extract_core_merchant
from categorizer import train_categorizer
import plaid_service

app = FastAPI(title="Financial Command Center API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_ROOT = "data"
USER_ROOT = os.path.join(DATA_ROOT, "users")
MASTER_DB_PATH = os.path.join(DATA_ROOT, "master_transactions.csv")
EXCEL_HISTORY_PATH = "legacy_categories.xlsx"
RULES_PATH = os.path.join(DATA_ROOT, "merchant_rules.csv")
CATEGORIES_PATH = os.path.join(DATA_ROOT, "user_categories.csv")
SETTINGS_PATH = os.path.join(DATA_ROOT, "settings.json")
WHITELIST_PATH = os.path.join(DATA_ROOT, "multi_category_merchants.txt")
SMART_RULES_PATH = os.path.join(DATA_ROOT, "smart_rules.json")

if not os.path.exists(DATA_ROOT):
    os.makedirs(DATA_ROOT)
if not os.path.exists(USER_ROOT):
    os.makedirs(USER_ROOT)

import threading
import tempfile

# Serializes writes to the master DB so two overlapping requests can't interleave a
# read-modify-write and lose each other's changes.
_write_lock = threading.RLock()

def save_master_df(df, path=MASTER_DB_PATH):
    """Atomically persist the master ledger.

    Writes to a temp file in the same directory and os.replace()s it into place, so an
    interrupted write (e.g. the --reload worker restarting mid-save) can never leave the
    user's transaction history truncated or half-written.
    """
    with _write_lock:
        target_dir = os.path.dirname(os.path.abspath(path))
        fd, tmp_path = tempfile.mkstemp(suffix=".tmp", prefix="master_", dir=target_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
                df.to_csv(f, index=False)
            os.replace(tmp_path, path)
        except Exception:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            raise

def load_whitelisted_merchants():
    if not os.path.exists(WHITELIST_PATH):
        return set()
    try:
        with open(WHITELIST_PATH, "r", encoding="utf-8") as f:
            return {line.strip().upper() for line in f if line.strip()}
    except Exception as e:
        print(f"Error loading whitelisted merchants: {e}")
        return set()

def save_whitelisted_merchant(merchant: str):
    merchants = load_whitelisted_merchants()
    merchants.add(merchant.strip().upper())
    try:
        with open(WHITELIST_PATH, "w", encoding="utf-8") as f:
            for m in sorted(merchants):
                f.write(f"{m}\n")
    except Exception as e:
        print(f"Error saving whitelisted merchant: {e}")

class LedgerUpdate(BaseModel):
    transaction_id: str
    category: str

class BulkLedgerUpdate(BaseModel):
    updates: List[LedgerUpdate]

class ConflictResolution(BaseModel):
    merchant: str
    target_category: str

class ConflictWhitelist(BaseModel):
    merchant: str

class LedgerDismiss(BaseModel):
    transaction_id: str
    dismissed_category: str

class DuplicateRemoval(BaseModel):
    transaction_ids: List[str]

class SingleRecategorize(BaseModel):
    transaction_id: str
    category: str

class ScopedRecategorize(BaseModel):
    transaction_id: str
    category: str
    # Sweep scope: "one" (just this charge), "year" (every charge from the same
    # merchant in the same calendar year), or "all" (all-time, also saves a rule).
    scope: str = "one"

class CategoriesUpdate(BaseModel):
    categories: dict  # Format: {"Income": [...], "Expense": [...], "Savings": [...], "Transfer": [...]}

class SettingsUpdate(BaseModel):
    declared_banks: List[dict]
    budgets: dict
    # Global ingest switch: "csv" (manual uploads) or "plaid" (auto-sync only).
    ingest_mode: Optional[str] = "csv"
    # Plaid never imports transactions dated on/before this cutover, so its initial
    # backfill can't overlap/duplicate the CSV history that precedes the switch.
    plaid_cutover_date: Optional[str] = "2026-06-01"
    # Annual contribution caps per tax-advantaged account (editable; 2026 IRS defaults).
    contribution_limits: Optional[dict] = None

class PlaidLinkTokenRequest(BaseModel):
    person: str

class PlaidExchangeRequest(BaseModel):
    public_token: str
    person: str
    institution_name: Optional[str] = None

class PlaidSyncRequest(BaseModel):
    person: Optional[str] = None

class SmartRuleModel(BaseModel):
    keyword: str
    category: str
    amount_op: str = "any"          # any | positive | negative | gte | lte
    amount_value: Optional[float] = 0
    date_start: Optional[str] = None  # "YYYY-MM-DD"
    date_end: Optional[str] = None
    person: Optional[str] = None      # None / "All Users" => all profiles

def load_categories():
    """Loads categories dynamically from user_categories.csv, falling back to defaults if empty."""
    default_cats = {
        'Income': ['Salary', 'Zelle Transfers', 'Wages', 'Income', 'Rewards', 'Refunds'],
        'Savings': ['Emergency Fund', 'Brokerage', 'Crypto', 'Investments', 'Roth IRA', 'HSA'],
        'Expense': ['Dining', 'Groceries', 'Gas', 'Merchandise', 'Travel', 'Housing', 'Bills', 'Personal Growth Expenses', 'Debt', 'Education', 'Entertainment', 'Food & Dining', 'Gifts & Donations', 'Health & Fitness', 'Insurance', 'Personal Care', 'Pets', 'Shopping', 'Taxes', 'Transportation', 'Uncategorized', 'Clothes', 'Fees', 'Car Expenses', 'Subscription', 'Fun'],
        'Transfer': ['Transfer', 'Credit Card Payment', 'Card Payment', 'CC Payment', 'CC payment']
    }
    
    # Sort default categories alphabetically
    for key in default_cats:
        default_cats[key] = sorted(list(set(default_cats[key])), key=lambda s: s.lower())
        
    if not os.path.exists(CATEGORIES_PATH):
        return default_cats
    try:
        df = pd.read_csv(CATEGORIES_PATH)
        categories = {'Income': [], 'Expense': [], 'Savings': [], 'Transfer': []}
        for _, row in df.iterrows():
            cat = str(row['Category']).strip()
            t = str(row['Type']).strip()
            # Normalize type name
            t_cap = t.capitalize()
            if t_cap not in categories:
                categories[t_cap] = []
            categories[t_cap].append(cat)
            
        # Ensure Uncategorized is always in Expense
        if 'Uncategorized' not in categories['Expense']:
            categories['Expense'].append('Uncategorized')
            
        # Dynamically merge loaded categories with defaults
        for key in default_cats:
            if key not in categories:
                categories[key] = []
            merged_set = set(categories[key]) | set(default_cats[key])
            categories[key] = sorted(list(merged_set), key=lambda s: s.lower())
            
        return categories
    except Exception as e:
        print(f"Error loading categories: {e}")
        return default_cats

def load_custom_rules():
    if not os.path.exists(RULES_PATH): return {}
    try:
        df = pd.read_csv(RULES_PATH)
        # Highly defensive synonym checking to prevent any KeyError
        merchant_col = None
        category_col = None
        
        for col in df.columns:
            col_lower = col.lower().strip()
            if col_lower in ['merchant', 'original_group_key', 'alias', 'original group key']:
                merchant_col = col
            elif col_lower == 'category':
                category_col = col
                
        if merchant_col and category_col:
            return dict(zip(df[merchant_col], df[category_col]))
        return {}
    except Exception as e:
        print(f"Error loading rules dynamically: {e}")
        return {}

# ----------------------------------------------------------------------------
#  SMART CONDITIONAL RULES
#  A keyword can map to different categories depending on the amount sign/size
#  and/or date range (e.g. "VENMO" positive => Income, "VENMO" negative => Dining).
# ----------------------------------------------------------------------------
def load_smart_rules():
    if not os.path.exists(SMART_RULES_PATH):
        return []
    try:
        import json
        with open(SMART_RULES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"Error loading smart rules: {e}")
        return []

def save_smart_rules(rules):
    try:
        import json
        with open(SMART_RULES_PATH, "w", encoding="utf-8") as f:
            json.dump(rules, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving smart rules: {e}")
        return False

def _smart_rule_mask(df, rule):
    """Builds a boolean mask over df for a single smart rule."""
    keyword = str(rule.get("keyword", "")).strip()
    if not keyword:
        return pd.Series(False, index=df.index)

    desc = df['Description'].astype(str)
    mask = desc.str.contains(re.escape(keyword), case=False, na=False)

    amt = pd.to_numeric(df['Amount'], errors='coerce').fillna(0)
    op = str(rule.get("amount_op", "any"))
    try:
        val = float(rule.get("amount_value") or 0)
    except (TypeError, ValueError):
        val = 0.0

    if op == "positive":
        mask &= amt > 0
    elif op == "negative":
        mask &= amt < 0
    elif op == "gte":
        mask &= amt.abs() >= val
    elif op == "lte":
        mask &= amt.abs() <= val

    date_start = rule.get("date_start")
    date_end = rule.get("date_end")
    if date_start or date_end:
        dts = pd.to_datetime(df['Date'], errors='coerce')
        if date_start:
            mask &= dts >= pd.to_datetime(date_start, errors='coerce')
        if date_end:
            mask &= dts <= pd.to_datetime(date_end, errors='coerce')

    person = rule.get("person")
    if person and person != "All Users" and 'Person' in df.columns:
        mask &= df['Person'].astype(str) == person

    return mask.fillna(False)

def apply_smart_rules_to_master():
    """Applies every smart rule (in order; later rules override earlier on overlap) to the master DB."""
    rules = load_smart_rules()
    if not rules or not os.path.exists(MASTER_DB_PATH):
        return 0
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if df.empty:
            return 0
        total_changed = 0
        for rule in rules:
            cat = rule.get("category")
            if not cat:
                continue
            mask = _smart_rule_mask(df, rule)
            if mask.any():
                changed = int((df.loc[mask, 'Category'].astype(str) != str(cat)).sum())
                df.loc[mask, 'Category'] = cat
                total_changed += changed
        if total_changed > 0:
            save_master_df(df)
            print(f"⚙️ Smart Rules: re-categorized {total_changed} transactions.")
        return total_changed
    except Exception as e:
        print(f"Error applying smart rules: {e}")
        return 0

def _count_rule_matches(rule):
    if not os.path.exists(MASTER_DB_PATH):
        return 0
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        return int(_smart_rule_mask(df, rule).sum())
    except Exception:
        return 0


def seed_merchant_rules():
    """Seeds a rule library of 50+ common merchants if the rules file is empty or small."""
    if os.path.exists(RULES_PATH):
        try:
            if os.path.getsize(RULES_PATH) > 100:
                return
        except:
            pass
            
    seed_rules = [
        ("AMAZON", "Shopping"),
        ("AMZN MKTPL", "Shopping"),
        ("STARBUCKS", "Dining"),
        ("NETFLIX", "Subscription"),
        ("SPOTIFY", "Subscription"),
        ("GOOGLE ONE", "Subscription"),
        ("YOUTUBE", "Subscription"),
        ("CLASSPASS", "Subscription"),
        ("SURFSHARK", "Subscription"),
        ("HULU", "Subscription"),
        ("DISNEY", "Subscription"),
        ("SHELL OIL", "Gas"),
        ("CHEVRON", "Gas"),
        ("MOBIL", "Gas"),
        ("EXXON", "Gas"),
        ("TESLA SUPERCHARGE", "Gas"),
        ("COSTCO WHOLESE", "Groceries"),
        ("RALPHS", "Groceries"),
        ("WALMART", "Groceries"),
        ("WM SUPERCENTER", "Groceries"),
        ("SMART AND FINAL", "Groceries"),
        ("H MART", "Groceries"),
        ("ALDI", "Groceries"),
        ("WHOLEFDS", "Groceries"),
        ("TRADER JOE S", "Groceries"),
        ("99 RANCH", "Groceries"),
        ("UBER", "Travel"),
        ("LYFT", "Travel"),
        ("AIRBNB", "Travel"),
        ("AUTOPAY", "Transfer"),
        ("DIRECTPAY", "Transfer"),
        ("PAYMENT", "Transfer"),
        ("CAPITAL ONE AUTOPAY", "Transfer"),
        ("DISCOVER PYMT", "Transfer"),
        ("CHASE AUTOPAY", "Transfer"),
        ("CVS PHARMACY", "Personal Care"),
        ("WALGREENS", "Personal Care"),
        ("IN N OUT", "Dining"),
        ("MCDONALDS", "Dining"),
        ("CHICK FIL A", "Dining"),
        ("TOKYO CENTRAL", "Dining"),
        ("BOILING POINT", "Dining"),
        ("PAYROLL", "Income"),
        ("WAGES", "Income"),
        ("DIRECT DEPOSIT", "Income"),
        ("GOOGLE PLAY", "Entertainment"),
        ("APPLE STORE", "Entertainment"),
        ("REWARDS", "Income"),
        ("REFUNDS", "Income")
    ]
    df = pd.DataFrame(seed_rules, columns=["Merchant", "Category"])
    df.to_csv(RULES_PATH, index=False)

def _is_verified_flag(v):
    """True when a row's Verified flag marks it as a user-confirmed category.
    Tolerates CSV round-tripping (True/'True'/'1'/1.0/'yes')."""
    return str(v).strip().lower() in ('true', '1', '1.0', 'yes')


def auto_categorize_master_db():
    """Automatically cleans up the master database using loaded rule dictionaries and smart keywords on startup."""
    if not os.path.exists(MASTER_DB_PATH):
        return
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        
        # Defensively ensure Dismissed_Categories column exists
        if 'Dismissed_Categories' not in df.columns:
            df['Dismissed_Categories'] = ""
            save_master_df(df)

        # Ensure Account column exists
        if 'Account' not in df.columns:
            df['Account'] = 'Legacy Account'

        # Ensure Verified column exists — it marks user-confirmed categories so the
        # heuristic sweep below never reverts a manual choice on restart (which is what
        # made the wizard re-ask the same transactions after every restart).
        if 'Verified' not in df.columns:
            df['Verified'] = False

        # Build a set of known credit card account names from settings + heuristics
        cc_account_names = set()
        settings = get_settings()
        for bank in settings.get('declared_banks', []):
            if bank.get('type') == 'Credit Card':
                cc_account_names.add(bank['name'].lower())
        # Also detect by common naming patterns
        for acct in df['Account'].dropna().unique():
            acct_lower = str(acct).lower()
            if any(kw in acct_lower for kw in ['visa', 'discover', 'citi', 'capital one', 'amex', 'sapphire', 'savor', 'credit', 'mastercard']):
                cc_account_names.add(acct_lower)
            
        updated_count = 0
        
        # 1. Sweep whole database to correct miscategorized positive amount transactions
        #    ONLY for banking/checking accounts where positive = genuine inflow.
        #    Credit card accounts are EXCLUDED since their positive amounts represent charges.
        for idx, row in df.iterrows():
            # Never override a category the user explicitly confirmed in the wizard.
            if _is_verified_flag(row.get('Verified')):
                continue
            amt = float(row['Amount'])
            desc = str(row['Description']).upper()
            cat = str(row['Category'])
            desc_lower = desc.lower()
            acct_lower = str(row.get('Account', '')).lower()
            is_credit_card = acct_lower in cc_account_names

            if amt > 0 and not is_credit_card:
                # A. Zelle from is always Income
                if 'zelle payment from' in desc_lower or 'zelle from' in desc_lower:
                    if cat != 'Income':
                        df.at[idx, 'Category'] = 'Income'
                        updated_count += 1
                # B. Direct Deposit / Payroll is always Income
                elif any(k in desc_lower for k in ['payroll', 'direct deposit', 'direct dep', 'wages', 'salary', 'covidien lp des:payroll', 'iplaza inc des:payroll', 'amazon.com svcs des:direct dep', 'amazon.com servi des:payments']):
                    if cat != 'Income':
                        df.at[idx, 'Category'] = 'Income'
                        updated_count += 1
                # C. Venmo Cashout is Income
                elif 'venmo des:cashout' in desc_lower or 'venmo cashout' in desc_lower or 'venmo des:rep' in desc_lower:
                    if cat != 'Income':
                        df.at[idx, 'Category'] = 'Income'
                        updated_count += 1
                # D. Bank/Mobile Check Deposit shouldn't be mapped to Expense categories like Gas
                elif 'deposit' in desc_lower:
                    if cat in ['Gas', 'Shopping', 'Dining', 'Groceries', 'Subscription', 'Travel']:
                        df.at[idx, 'Category'] = 'Uncategorized'
                        updated_count += 1
                # E. Expense category overrides ONLY for genuine banking inflows (not credit card charges)
                elif cat in ['Shopping', 'Gas', 'Dining', 'Groceries', 'Subscription', 'Travel', 'Education']:
                    if 'refund' in desc_lower or 'reward' in desc_lower:
                        if cat != 'Income':
                            df.at[idx, 'Category'] = 'Income'
                            updated_count += 1
                    elif cat == 'Uncategorized':
                        # Only reset if it was Uncategorized (don't override confirmed categories)
                        pass
                    else:
                        df.at[idx, 'Category'] = 'Uncategorized'
                        updated_count += 1

        # 2. Automatically categorize remaining Uncategorized transactions
        uncat_mask = df['Category'] == 'Uncategorized'
        if uncat_mask.any():
            custom_rules = load_custom_rules()
            for idx, row in df[uncat_mask].iterrows():
                desc = str(row['Description']).upper()
                clean_merchant = extract_core_merchant(row['Description'])
                amt = float(row['Amount'])
                acct_lower = str(row.get('Account', '')).lower()
                is_credit_card = acct_lower in cc_account_names
                new_cat = None
                
                # Check custom rules
                if clean_merchant in custom_rules:
                    new_cat = custom_rules[clean_merchant]
                else:
                    for rule_merch, rule_cat in custom_rules.items():
                        if rule_merch in clean_merchant or clean_merchant in rule_merch:
                            new_cat = rule_cat
                            break
                            
                # Apply fallbacks
                if not new_cat:
                    desc_lower = desc.lower()
                    if any(k in desc_lower for k in ['autopay', 'directpay', 'card payment', 'credit card payment', 'discover py', 'chase auto-pmt', 'capital one py', 'payment']):
                        if amt > 0 and ('zelle' in desc_lower or 'from' in desc_lower):
                            new_cat = "Income"
                        else:
                            new_cat = "Transfer"
                    elif any(k in desc_lower for k in ['payroll', 'direct deposit', 'zelle transfer', 'wages']):
                        new_cat = "Income"
                    elif any(k in desc_lower for k in ['netflix', 'spotify', 'hulu', 'disney+', 'youtube premium', 'subscription', 'youtube']):
                        new_cat = "Subscription"
                    elif any(k in desc_lower for k in ['paris baguette', 'wendy', 'canteen', 'starbucks', 'coffee', 'tea room', 'billiards', 'bakery', 'restaurant', 'dining', 'kitchen', 'grill', 'burger', 'pizza', 'ramen', 'sushi', 'boba', 'doughnuts', 'bagel', 'taco', 'caffe', 'cafe', 'mcdonald', 'dunkin', 'tst*', 'in-n-out', 'chick-fil-a', 'sweetgreen', 'chipotle', 'shake shack', 'subway']):
                        if amt < 0 or is_credit_card:
                            new_cat = "Dining"
                    elif any(k in desc_lower for k in ['macy', 'forever21', 'h&m', 'hm.com', 'target', 'nordstrom', 'uniqlo', 'zara', 'adidas', 'nike', 'clothing', 'department store', 'dsw', 'sephora', 'ulta', 'ikea', 'apple', 'best buy', 'home depot', 'lowes', 'amazon', 'marshalls', 'tj maxx', 'shopping', 'merchandise', 'walmart', 'ebay']):
                        if amt < 0 or is_credit_card:
                            new_cat = "Shopping"
                    elif any(k in desc_lower for k in ['7-eleven', '7 eleven', 'grocery', 'supermarket', 'vons', 'ralphs', 'costco', 'whole foods', 'trader joe', 'mitsuwa', 'h mart', 'h-mart', '99 ranch', 'convenience', 'market', 'albertsons', 'safeway', 'kroger', 'sprouts', 'food market']):
                        if amt < 0 or is_credit_card:
                            new_cat = "Groceries"
                    elif any(k in desc_lower for k in ['parking', 'airport', 'uber', 'lyft', 'transit', 'metro', 'taxi', 'subway', 'rail', 'flight', 'airline', 'chevron', 'shell', 'mobil', 'exxon', 'arco', '76 gas', 'gasoline', 'supercharge', 'tesla']):
                        if amt < 0 or is_credit_card:
                            new_cat = "Gas" if any(g in desc_lower for g in ['chevron', 'shell', 'mobil', 'exxon', 'arco', '76 gas', 'gasoline', 'fuel']) else "Travel"

                if new_cat:
                    # For banking accounts with positive amounts, guard against assigning expense categories
                    if amt > 0 and not is_credit_card and new_cat in ['Shopping', 'Gas', 'Dining', 'Groceries', 'Subscription', 'Travel', 'Education']:
                        desc_lower = desc.lower()
                        if 'refund' in desc_lower or 'reward' in desc_lower:
                            new_cat = "Income"
                        else:
                            new_cat = "Uncategorized"
                            
                    df.at[idx, 'Category'] = new_cat
                    updated_count += 1
                    
        if updated_count > 0:
            save_master_df(df)
            print(f"✨ Smart Startup Sweep: Automatically categorized and swept {updated_count} transactions!")
    except Exception as e:
        print(f"Error during startup auto-categorization sweep: {e}")


def compress_existing_archives():
    """Finds any uncompressed .csv files in user archive directories, compresses them to .gz, and removes the originals."""
    if not os.path.exists(USER_ROOT):
        return
    import gzip
    try:
        compressed_count = 0
        for person in os.listdir(USER_ROOT):
            person_dir = os.path.join(USER_ROOT, person)
            if not os.path.isdir(person_dir):
                continue
            archive_dir = os.path.join(person_dir, "archive")
            if not os.path.exists(archive_dir):
                continue
                
            for file in os.listdir(archive_dir):
                if file.lower().endswith('.csv'):
                    filepath = os.path.join(archive_dir, file)
                    gz_path = filepath + ".gz"
                    try:
                        with open(filepath, 'rb') as f_in:
                            with gzip.open(gz_path, 'wb') as f_out:
                                shutil.copyfileobj(f_in, f_out)
                        os.remove(filepath)
                        compressed_count += 1
                    except Exception as fe:
                        print(f"Error compressing archive file {file}: {fe}")
                        
        if compressed_count > 0:
            print(f"📦 Space-Saving Audit: Successfully compressed {compressed_count} existing archive CSV files to Gzip!")
    except Exception as e:
        print(f"Error running archive compression sweep: {e}")



# Defaults injected into any settings payload so the ingest switch + cutover are
# always present even for older settings.json files written before this feature.
INGEST_DEFAULTS = {
    "ingest_mode": "csv",
    "plaid_cutover_date": "2026-06-01",
    # 2026 IRS limits: Roth IRA $7,000 (under 50); HSA $4,400 self-only. Editable in the UI.
    "contribution_limits": {"Roth IRA": 7000, "HSA": 4400},
}


@app.get("/api/settings")
def get_settings():
    if not os.path.exists(SETTINGS_PATH):
        # Default settings if it doesn't exist
        return {
            "declared_banks": [
                {"name": "BofA Checking", "type": "Banking", "owner": "big_boo"},
                {"name": "Chase Sapphire", "type": "Credit Card", "owner": "big_boo"},
                {"name": "Discover Card", "type": "Credit Card", "owner": "big_boo"}
            ],
            "budgets": {},
            **INGEST_DEFAULTS,
        }
    try:
        import json
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        for k, v in INGEST_DEFAULTS.items():
            data.setdefault(k, v)
        return data
    except Exception as e:
        print(f"Error loading settings: {e}")
        return {"declared_banks": [], "budgets": {}, **INGEST_DEFAULTS}

@app.post("/api/settings")
def save_settings(settings: SettingsUpdate):
    try:
        import json
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(settings.dict(), f, indent=2)
        return {"status": "success", "message": "Settings saved successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/categories")
def get_categories():
    """Exposes current dynamic category taxonomy."""
    return load_categories()

@app.post("/api/categories")
def save_categories(update: CategoriesUpdate):
    """Saves category configuration, automatically renaming matching DB records, or resetting deleted categories."""
    try:
        old_cats = load_categories()
        
        # Build flattened lists
        old_flat = [c for c_list in old_cats.values() for c in c_list]
        new_flat = [c for c_list in update.categories.values() for c in c_list]
        
        # Check renames
        removed = [c for c in old_flat if c not in new_flat and c != 'Uncategorized']
        added = [c for c in new_flat if c not in old_flat and c != 'Uncategorized']
        
        renames = {}
        if len(removed) == 1 and len(added) == 1:
            renames[removed[0]] = added[0]
            print(f"🔄 Stranded category rename detected: {removed[0]} ➔ {added[0]}")
            
        # Write new categories configuration
        rows = []
        for cat_type, cat_list in update.categories.items():
            for cat in cat_list:
                if cat.strip():
                    rows.append({"Category": cat.strip(), "Type": cat_type.strip()})
        df_config = pd.DataFrame(rows)
        df_config.to_csv(CATEGORIES_PATH, index=False)
        
        # Sweep database to propagate renaming and safely reset deleted items
        if os.path.exists(MASTER_DB_PATH):
            df_db = pd.read_csv(MASTER_DB_PATH)
            
            # Apply Renames
            for old_name, new_name in renames.items():
                df_db.loc[df_db['Category'] == old_name, 'Category'] = new_name
                
            # Revert deleted categories to Uncategorized
            for old_name in removed:
                if old_name not in renames:
                    df_db.loc[df_db['Category'] == old_name, 'Category'] = 'Uncategorized'
                    
            save_master_df(df_db)
            
        return {"status": "success", "message": "Categories updated and database swept successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/upload")
async def upload_files(
    bucket: str = Form(...), 
    user_profile: str = Form(...), 
    account_name: Optional[str] = Form(None),
    files: List[UploadFile] = File(...)
):
    # --- Guard against CSV/Plaid double-feeding -------------------------------------
    # 1. Global switch: in "plaid" mode all manual CSV uploads are disabled.
    # 2. Per-profile: even in CSV mode, a profile already linked to Plaid must not also
    #    receive CSV uploads, or the same transactions arrive under two different IDs.
    settings = get_settings()
    if (settings.get("ingest_mode") or "csv").lower() == "plaid":
        return {
            "status": "error",
            "message": "CSV uploads are disabled — the app is in Plaid mode. "
                       "Switch to CSV mode in Settings to upload statements.",
        }
    if any(it.get("person") == user_profile for it in plaid_service.list_items()):
        return {
            "status": "error",
            "message": f"'{user_profile}' is connected through Plaid, so transactions "
                       f"sync automatically. CSV upload is blocked for this profile to "
                       f"avoid duplicate transactions.",
        }

    new_dataframes = []
    custom_rules = load_custom_rules()

    # 1. Establish the clean multi-user folder path
    user_raw_dir = os.path.join(USER_ROOT, user_profile, "raw", "credit_cards" if "Credit Card" in bucket else "banking")
    user_archive_dir = os.path.join(USER_ROOT, user_profile, "archive")
    os.makedirs(user_raw_dir, exist_ok=True)
    os.makedirs(user_archive_dir, exist_ok=True)
    
    if not account_name:
        account_name = "Chase Sapphire" if "Credit Card" in bucket else "Chase Checking"
        
    for file in files:
        # Save file directly inside the user's raw folders
        filepath = os.path.join(user_raw_dir, file.filename)
        with open(filepath, "wb+") as file_object:
            shutil.copyfileobj(file.file, file_object)
            
        try:
            # Standardize and clean
            df_new = clean_bank_csv(filepath)
            df_new['Person'] = user_profile
            df_new['Category'] = 'Uncategorized'
            df_new['Account'] = account_name
            df_new['Dismissed_Categories'] = ""
            
            # Apply continuous learning rules
            if custom_rules:
                clean_desc = df_new['Description'].apply(extract_core_merchant)
                df_new['Category'] = clean_desc.map(custom_rules).fillna('Uncategorized')
                
            if "Credit Card" in bucket:
                df_new['Amount'] = df_new['Amount'].abs() * -1
                
            new_dataframes.append(df_new)
            
            # Symmetrically archive the file using Gzip compression to save space
            import gzip
            archive_path = os.path.join(user_archive_dir, file.filename + ".gz")
            with open(filepath, 'rb') as f_in:
                with gzip.open(archive_path, 'wb') as f_out:
                    shutil.copyfileobj(f_in, f_out)
            if os.path.exists(filepath):
                os.remove(filepath)
            
        except Exception as e:
            print(f"Error parsing {file.filename}: {e}")
            if os.path.exists(filepath): os.remove(filepath)
                
    if not new_dataframes: return {"status": "error", "message": "No valid files processed."}

    df_combined_new = pd.concat(new_dataframes)
    if os.path.exists(MASTER_DB_PATH):
        df_master = pd.read_csv(MASTER_DB_PATH)
        if 'Account' not in df_master.columns:
            df_master['Account'] = 'Legacy Account'
        df_final = pd.concat([df_master, df_combined_new]).drop_duplicates(subset=['Transaction_ID'], keep='last')
    else:
        df_final = df_combined_new
        
    save_master_df(df_final)
    apply_smart_rules_to_master()
    return {"status": "success", "message": f"Processed and saved into data/users/{user_profile}/ for {account_name}"}

@app.get("/api/dashboard")
def get_dashboard_data(start_month: Optional[str] = None, end_month: Optional[str] = None, person: Optional[str] = None):
    if not os.path.exists(MASTER_DB_PATH):
        return {
            "kpis": {"income": 0, "expenses": 0, "savings": 0, "savingsRate": 0, "transfers": 0},
            "incomeData": [],
            "expenseData": [],
            "savingsData": [],
            "topMerchants": [],
            "topSources": [],
            "cardBreakdown": [],
            "trendData": [],
            "uniqueMonths": [],
            "uniqueProfiles": []
        }
        
    df = pd.read_csv(MASTER_DB_PATH)

    if 'Account' not in df.columns:
        df['Account'] = 'Legacy Account'
    df['YearMonth'] = pd.to_datetime(df['Date'], errors='coerce').dt.to_period('M').astype(str)
    df = df[df['YearMonth'] != 'NaT']
    
    # Classify types based on dynamic categories
    cats = load_categories()
    income_cats = cats.get('Income', [])
    savings_cats = cats.get('Savings', [])
    transfer_cats = cats.get('Transfer', ['Transfer'])
    
    df['Type'] = 'Expense'
    df.loc[df['Category'].isin(income_cats) | ((df['Category'] == 'Uncategorized') & (df['Amount'] > 0)), 'Type'] = 'Income'
    df.loc[df['Category'].isin(savings_cats), 'Type'] = 'Savings'
    df.loc[df['Category'].isin(transfer_cats), 'Type'] = 'Transfer'
    
    # Collect months dropdown list
    unique_months = sorted(df['YearMonth'].dropna().unique(), reverse=True)
    
    # Dynamically scan folder directories inside data/users/ for active profiles
    unique_profiles = sorted([d for d in os.listdir(USER_ROOT) if os.path.isdir(os.path.join(USER_ROOT, d))])
    if not unique_profiles:
        unique_profiles = ["big_boo", "lil_boo"] # fallback
        
    # Normalize date-range bounds so a partial range (only From or only To) still filters
    range_start = start_month if start_month and start_month != "All Time" else None
    range_end = end_month if end_month and end_month != "All Time" else None

    # Historical Trend Data
    # Scope to the selected person so the trend chart reflects the individual
    trend_df = df if (not person or person == "All Users") else df[df['Person'] == person]

    trend_scope = trend_df
    if range_start:
        trend_scope = trend_scope[trend_scope['YearMonth'] >= range_start]
    if range_end:
        trend_scope = trend_scope[trend_scope['YearMonth'] <= range_end]
    trend_months = sorted(trend_scope['YearMonth'].dropna().unique())

    trend_data = []
    for m in trend_months:
        month_df = trend_df[trend_df['YearMonth'] == m]
        m_inc = month_df[month_df['Type'] == 'Income']['Amount'].abs().sum()
        m_exp = month_df[month_df['Type'] == 'Expense']['Amount'].abs().sum()
        m_sav = month_df[month_df['Type'] == 'Savings']['Amount'].abs().sum()
        trend_data.append({
            "month": m,
            "income": float(round(m_inc, 2)),
            "expenses": float(round(m_exp, 2)),
            "savings": float(round(m_sav, 2))
        })

    # Apply date range filtering (each bound applies independently)
    if range_start:
        df = df[df['YearMonth'] >= range_start]
    if range_end:
        df = df[df['YearMonth'] <= range_end]
    if person and person != "All Users":
        df = df[df['Person'] == person]
        
    income_df = df[df['Type'] == 'Income'].copy()
    expense_df = df[df['Type'] == 'Expense'].copy()
    savings_df = df[df['Type'] == 'Savings'].copy()
    transfer_df = df[df['Type'] == 'Transfer'].copy()
    
    income_df['Amount'] = income_df['Amount'].abs()
    expense_df['Amount'] = expense_df['Amount'].abs()
    savings_df['Amount'] = savings_df['Amount'].abs()
    transfer_df['Amount'] = transfer_df['Amount'].abs()
    
    def format_for_recharts(dataframe):
        if dataframe.empty: return []
        grouped = dataframe.groupby('Category')['Amount'].sum().reset_index()
        grouped = grouped.rename(columns={"Category": "name", "Amount": "value"})
        grouped['value'] = grouped['value'].round(2)
        return grouped.to_dict(orient='records')
        
    card_breakdown = []
    if not expense_df.empty:
        card_grouped = expense_df.groupby('Account')['Amount'].sum().round(2).reset_index()
        card_breakdown = card_grouped.rename(columns={"Account": "name", "Amount": "value"}).to_dict(orient='records')
        
    top_merchants = []
    if not expense_df.empty:
        expense_df['Merchant'] = expense_df['Description'].apply(extract_core_merchant)
        merchant_grouped = expense_df.groupby('Merchant')['Amount'].sum().round(2).reset_index()
        merchant_grouped = merchant_grouped.sort_values(by='Amount', ascending=False).head(5)
        top_merchants = merchant_grouped.rename(columns={"Merchant": "name", "Amount": "value"}).to_dict(orient='records')

    top_sources = []
    if not income_df.empty:
        income_df['Source'] = income_df['Description'].apply(extract_core_merchant)
        source_grouped = income_df.groupby('Source')['Amount'].sum().round(2).reset_index()
        source_grouped = source_grouped.sort_values(by='Amount', ascending=False).head(5)
        top_sources = source_grouped.rename(columns={"Source": "name", "Amount": "value"}).to_dict(orient='records')

    # Top Merchants per category
    category_merchants = {}
    if not expense_df.empty:
        for cat in expense_df['Category'].unique():
            cat_df = expense_df[expense_df['Category'] == cat]
            m_grouped = cat_df.groupby('Merchant')['Amount'].sum().round(2).reset_index()
            m_grouped = m_grouped.sort_values(by='Amount', ascending=False).head(5)
            category_merchants[str(cat)] = m_grouped.rename(columns={"Merchant": "name", "Amount": "value"}).to_dict(orient='records')

    # Top Sources per category
    category_sources = {}
    if not income_df.empty:
        for cat in income_df['Category'].unique():
            cat_df = income_df[income_df['Category'] == cat]
            s_grouped = cat_df.groupby('Source')['Amount'].sum().round(2).reset_index()
            s_grouped = s_grouped.sort_values(by='Amount', ascending=False).head(5)
            category_sources[str(cat)] = s_grouped.rename(columns={"Source": "name", "Amount": "value"}).to_dict(orient='records')

    # Top contributors per savings category (so the Savings donut has detail too)
    category_savings = {}
    if not savings_df.empty:
        savings_df['Source'] = savings_df['Description'].apply(extract_core_merchant)
        for cat in savings_df['Category'].unique():
            cat_df = savings_df[savings_df['Category'] == cat]
            sv_grouped = cat_df.groupby('Source')['Amount'].sum().round(2).reset_index()
            sv_grouped = sv_grouped.sort_values(by='Amount', ascending=False).head(5)
            category_savings[str(cat)] = sv_grouped.rename(columns={"Source": "name", "Amount": "value"}).to_dict(orient='records')

    income_sum = float(round(income_df['Amount'].sum(), 2))
    expense_sum = float(round(expense_df['Amount'].sum(), 2))
    savings_sum = float(round(savings_df['Amount'].sum(), 2))
    transfer_sum = float(round(transfer_df['Amount'].sum(), 2)) # AutoPay sum completely isolated!
    savings_rate = float(round((savings_sum / income_sum * 100), 1)) if income_sum > 0 else 0.0

    settings = get_settings()
    budgets = settings.get("budgets", {})
    budget_tracking = []
    if not expense_df.empty:
        # "Active Monthly Budgets" tracks the live, in-progress month: the whole point is
        # to watch how much of each cap you've spent *this* month. So anchor on the most
        # recent month in view (including the current partial month) — unlike the health
        # score / advisor, which exclude the partial month for averages.
        months_in_view = sorted(expense_df['YearMonth'].dropna().unique())
        latest_month = months_in_view[-1] if months_in_view else None
    else:
        latest_month = None

    if latest_month:
        month_expense_df = expense_df[expense_df['YearMonth'] == latest_month]
        category_spent = month_expense_df.groupby('Category')['Amount'].sum().to_dict()
        for category, cap in budgets.items():
            actual = category_spent.get(category, 0.0)
            budget_tracking.append({
                "category": category,
                "actual": round(float(actual), 2),
                "budget": round(float(cap), 2),
                "percent": round(float((actual / cap) * 100), 1) if cap > 0 else 0.0,
                "month": latest_month
            })
        for category, actual in category_spent.items():
            if category not in budgets:
                budget_tracking.append({
                    "category": category,
                    "actual": round(float(actual), 2),
                    "budget": 0.0,
                    "percent": 0.0,
                    "month": latest_month
                })

    return {
        "kpis": {
            "income": income_sum, 
            "expenses": expense_sum, 
            "savings": savings_sum,
            "savingsRate": savings_rate,
            "transfers": transfer_sum
        },
        "incomeData": format_for_recharts(income_df),
        "expenseData": format_for_recharts(expense_df),
        "savingsData": format_for_recharts(savings_df),
        "topMerchants": top_merchants,
        "topSources": top_sources,
        "cardBreakdown": card_breakdown,
        "trendData": trend_data,
        "uniqueMonths": unique_months,
        "uniqueProfiles": unique_profiles,
        "budgetTracking": budget_tracking,
        "categoryMerchants": category_merchants,
        "categorySources": category_sources,
        "categorySavings": category_savings
    }

@app.get("/api/subscriptions")
def get_subscriptions(person: Optional[str] = None):
    """Returns detected recurring expenses and active subscriptions."""
    items = detect_recurring_expenses()
    if person and person != "All Users":
        items = [x for x in items if x.get("person") == person]
    return items

@app.get("/api/savings_advisor")
def get_savings_advice(person: Optional[str] = None):
    """Generates personalized financial transparency alerts and actionable micro-savings tips."""
    if not os.path.exists(MASTER_DB_PATH):
        return []
        
    df = pd.read_csv(MASTER_DB_PATH)
    if df.empty:
        return []
        
    if person and person != "All Users":
        df = df[df['Person'] == person]
        
    if df.empty:
        return []
        
    df['YearMonth'] = pd.to_datetime(df['Date'], errors='coerce').dt.to_period('M').astype(str)
    
    cats = load_categories()
    income_cats = cats.get('Income', [])
    savings_cats = cats.get('Savings', [])
    transfer_cats = cats.get('Transfer', ['Transfer'])
    
    df['Type'] = 'Expense'
    df.loc[df['Category'].isin(income_cats) | ((df['Category'] == 'Uncategorized') & (df['Amount'] > 0)), 'Type'] = 'Income'
    df.loc[df['Category'].isin(savings_cats), 'Type'] = 'Savings'
    df.loc[df['Category'].isin(transfer_cats), 'Type'] = 'Transfer'
    
    months = sorted(df['YearMonth'].dropna().unique())
    if len(months) < 1:
        return []

    # The latest calendar month is typically partial (statements exported mid-month),
    # so its totals are incomplete and would skew the month-over-month spike alerts,
    # savings-rate target, dining/uncategorized thresholds, and budget alarms below.
    # Treat the in-progress calendar month as incomplete and anchor "this month" on the
    # latest *complete* month. Mirrors the exclusion approach in /api/health_score.
    import datetime as _dt
    current_period = _dt.date.today().strftime('%Y-%m')
    complete_months = [m for m in months if m < current_period] or months

    current_month = complete_months[-1]
    prev_months = complete_months[-4:-1]
    
    tips = []

    # Calculate average monthly expense
    monthly_expenses = df[df['Type'] == 'Expense'].groupby('YearMonth')['Amount'].sum().abs()
    avg_monthly_expense = float(monthly_expenses.mean()) if not monthly_expenses.empty else 0.0
    
    # Estimate current liquid cash (total net income - total expenses - savings transfers)
    total_income = df[df['Type'] == 'Income']['Amount'].abs().sum()
    total_expense = df[df['Type'] == 'Expense']['Amount'].abs().sum()
    total_savings = df[df['Type'] == 'Savings']['Amount'].abs().sum()
    estimated_liquid_cash = float(max(1000.0, total_income - total_expense - total_savings))

    # A. Cash Cushion Heuristic
    if avg_monthly_expense > 0:
        cash_cushion_ratio = estimated_liquid_cash / avg_monthly_expense
        if cash_cushion_ratio < 1.5:
            tips.append({
                "type": "cushion",
                "title": "Low Cash Cushion Warning",
                "description": f"Your estimated liquid cash cushion (${estimated_liquid_cash:,.2f}) is only {cash_cushion_ratio:.1f}x of your average monthly expense burden (${avg_monthly_expense:,.2f}).",
                "savingTip": "Build a secure runway by pausing non-essential shopping and routing 15% of salary directly to your checking account.",
                "severity": "high"
            })

    # B. Savings Target Ratio for current month
    month_df = df[df['YearMonth'] == current_month]
    m_inc = float(month_df[month_df['Type'] == 'Income']['Amount'].abs().sum())
    m_sav = float(month_df[month_df['Type'] == 'Savings']['Amount'].abs().sum())
    if m_inc > 0:
        m_savings_rate = (m_sav / m_inc * 100)
        if m_savings_rate >= 20.0:
            tips.append({
                "type": "target_savings",
                "title": "Savings Target Achieved!",
                "description": f"Incredible job! Your savings rate this month is {m_savings_rate:.1f}%, exceeding the golden 20% savings rule by saving ${m_sav:,.2f}.",
                "savingTip": "Keep this momentum! Automate these savings so they happen before you have a chance to spend them.",
                "severity": "low"
            })
        else:
            suggested_sav = m_inc * 0.20
            deficit = suggested_sav - m_sav
            tips.append({
                "type": "target_savings",
                "title": "Savings Growth Opportunity",
                "description": f"Your savings rate this month is {m_savings_rate:.1f}% (${m_sav:,.2f} saved). The standard target is 20% (${suggested_sav:,.2f}).",
                "savingTip": f"Try setting up an automated recurring transfer of ${deficit/4.33:,.2f}/week to your brokerage or emergency fund to seamlessly hit your target.",
                "severity": "medium"
            })

    # C. Category Budget Alarms from settings
    settings = get_settings()
    budgets = settings.get("budgets", {})
    if budgets:
        month_expense_df = df[(df['Type'] == 'Expense') & (df['YearMonth'] == current_month)]
        category_spent = month_expense_df.groupby('Category')['Amount'].sum().abs().to_dict()
        for category, cap in budgets.items():
            actual = category_spent.get(category, 0.0)
            if cap > 0:
                ratio = actual / cap
                if ratio >= 0.85:
                    tips.append({
                        "type": "budget_breach",
                        "title": f"Budget Alarm: {category}",
                        "description": f"You have spent ${actual:,.2f} on {category} this month, which is {int(ratio*100)}% of your monthly budget cap of ${cap:,.2f}!",
                        "savingTip": "Consider pausing purchases in this category for the remaining days of the month to avoid overdrawing.",
                        "severity": "high" if ratio >= 1.0 else "medium"
                    })

    # D. HYSA Auto-Savings Trigger for Zelle / Checks
    zelle_deposits = df[(df['Type'] == 'Income') & (df['Description'].str.contains('ZELLE', case=False, na=False)) & (df['YearMonth'] == current_month)]
    if not zelle_deposits.empty:
        zelle_total = float(zelle_deposits['Amount'].abs().sum())
        tips.append({
            "type": "savings_routing",
            "title": "HYSA Auto-Savings Trigger",
            "description": f"We detected ${zelle_total:,.2f} in check/Zelle deposits in your checking account this month.",
            "savingTip": f"To optimize your interest, immediately route at least 50% (${zelle_total*0.5:,.2f}) into your High-Yield Savings Account (HYSA) earning 4.5%+ APY!",
            "severity": "medium"
        })
    
    # 1. Overspending Spikes comparison
    if len(prev_months) >= 1:
        current_data = df[df['YearMonth'] == current_month]
        historical_data = df[df['YearMonth'].isin(prev_months)]
        
        curr_cat = current_data[current_data['Type'] == 'Expense'].groupby('Category')['Amount'].sum().abs()
        
        hist_grouped = historical_data[historical_data['Type'] == 'Expense'].groupby(['YearMonth', 'Category'])['Amount'].sum().abs().reset_index()
        hist_cat_avg = hist_grouped.groupby('Category')['Amount'].mean()
        
        for category, curr_amt in curr_cat.items():
            if category in hist_cat_avg:
                avg_amt = hist_cat_avg[category]
                if avg_amt > 40 and curr_amt > avg_amt * 1.15:
                    excess = curr_amt - avg_amt
                    tips.append({
                        "type": "spike",
                        "title": f"Spike in {category} Spending",
                        "description": f"Your spending in {category} spiked to ${curr_amt:,.2f} this month, which is ${excess:,.2f} (+{int((curr_amt/avg_amt - 1)*100)}%) higher than your recent 3-month average of ${avg_amt:,.2f}.",
                        "savingTip": f"Setting a budget cap of ${avg_amt:,.2f} on {category} next month will save you around ${excess:,.2f}!",
                        "severity": "high" if excess > 100 else "medium"
                    })
                    
    # 2. Subscription Audit recommendation (scoped to the selected profile)
    subs = detect_recurring_expenses()
    if person and person != "All Users":
        subs = [s for s in subs if s.get('person') == person]
    active_subs = [s for s in subs if s.get('is_active') and s.get('frequency') != 'Transfer']
    if active_subs:
        total_monthly_sub_burden = sum(s['monthly_burden'] for s in active_subs)
        if total_monthly_sub_burden > 75:
            high_cost_subs = sorted(active_subs, key=lambda x: -x['monthly_burden'])[:2]
            tips.append({
                "type": "subscription",
                "title": "Subscription Audit Review",
                "description": f"You have {len(active_subs)} active subscriptions costing you ${total_monthly_sub_burden:,.2f}/month. Over a year, this sums up to ${total_monthly_sub_burden*12:,.2f}!",
                "savingTip": f"Consider reviewing high-burden items like {', '.join([s['merchant'] for s in high_cost_subs])}. Cancelling just one unused membership puts money straight back in your wallet.",
                "severity": "high" if total_monthly_sub_burden > 150 else "medium"
            })
            
    # 3. Micro-Savings Dining Tip
    curr_dining = df[(df['Type'] == 'Expense') & (df['Category'] == 'Dining') & (df['YearMonth'] == current_month)]['Amount'].abs().sum()
    if curr_dining > 250:
        tips.append({
            "type": "dining",
            "title": "Dining Out Opportunity",
            "description": f"You spent ${curr_dining:,.2f} eating out and ordering delivery this month.",
            "savingTip": "Cooking just 2 more meals at home per week instead of dining out can save you up to $100 this month.",
            "severity": "medium"
        })
        
    # 4. Uncategorized leak warning
    curr_uncat = df[(df['Category'] == 'Uncategorized') & (df['YearMonth'] == current_month)]['Amount'].abs().sum()
    if curr_uncat > 100:
        tips.append({
            "type": "leak",
            "title": "Uncategorized Cash Leak",
            "description": f"You have ${curr_uncat:,.2f} in uncategorized transactions waiting for confirmation.",
            "savingTip": "Head over to the AI Ledger and confirm these merchants so the budget engine can provide more accurate alerts.",
            "severity": "medium"
        })
        
    # Default fallback tip
    if not tips:
        tips.append({
            "type": "info",
            "title": "Financial Health: Excellent",
            "description": "Your monthly expenses are highly optimized and stable. We didn't spot any unusual spikes or overspending leaks!",
            "savingTip": "Consistency is key. Consider setting aside 15% of your dynamic income directly into high-yield savings or investment accounts.",
            "severity": "low"
        })
        
    return tips

def _clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


@app.get("/api/health_score")
def get_health_score(start_month: Optional[str] = None, end_month: Optional[str] = None, person: Optional[str] = None):
    """Computes a composite Financial Health Score (0-100) from five weighted pillars.

    Pillars: Savings Rate, Cash Cushion, Budget Adherence, Subscription Load, Spending Stability.
    Each pillar is scored 0-100; the overall score is their weighted sum and is mapped to a letter grade.
    """
    empty = {
        "score": 0, "grade": "—", "label": "No Data",
        "summary": "Upload statements to generate your financial health score.",
        "pillars": [], "available": False
    }
    if not os.path.exists(MASTER_DB_PATH):
        return empty

    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if df.empty:
            return empty

        if person and person != "All Users":
            df = df[df['Person'] == person]
        if df.empty:
            return empty

        df['YearMonth'] = pd.to_datetime(df['Date'], errors='coerce').dt.to_period('M').astype(str)
        df = df[df['YearMonth'] != 'NaT']

        # Honour the dashboard's date range so the score matches what the user is viewing
        range_start = start_month if start_month and start_month != "All Time" else None
        range_end = end_month if end_month and end_month != "All Time" else None
        if range_start:
            df = df[df['YearMonth'] >= range_start]
        if range_end:
            df = df[df['YearMonth'] <= range_end]
        if df.empty:
            return empty

        cats = load_categories()
        income_cats = cats.get('Income', [])
        savings_cats = cats.get('Savings', [])
        transfer_cats = cats.get('Transfer', ['Transfer'])

        df['Type'] = 'Expense'
        df.loc[df['Category'].isin(income_cats) | ((df['Category'] == 'Uncategorized') & (df['Amount'] > 0)), 'Type'] = 'Income'
        df.loc[df['Category'].isin(savings_cats), 'Type'] = 'Savings'
        df.loc[df['Category'].isin(transfer_cats), 'Type'] = 'Transfer'

        all_months = sorted(df['YearMonth'].dropna().unique())
        # The in-progress calendar month is partial, so it would distort burn-rate and
        # volatility math. Exclude it from behavioural windows (but keep it in cumulative totals).
        import datetime as _dt
        current_period = _dt.date.today().strftime('%Y-%m')
        complete_months = [m for m in all_months if m < current_period] or all_months
        months = complete_months
        # Focus recent-behaviour pillars on the last 3 complete months for a "current state" read
        recent_months = complete_months[-3:]
        recent_df = df[df['YearMonth'].isin(recent_months)]
        # Trailing window for burn rate and volatility (more representative than multi-year history)
        trailing_months = complete_months[-6:]

        total_income = float(df[df['Type'] == 'Income']['Amount'].abs().sum())
        total_expense = float(df[df['Type'] == 'Expense']['Amount'].abs().sum())
        total_savings = float(df[df['Type'] == 'Savings']['Amount'].abs().sum())

        full_monthly_exp = df[df['Type'] == 'Expense'].groupby('YearMonth')['Amount'].apply(lambda s: s.abs().sum())
        monthly_exp_series = full_monthly_exp[full_monthly_exp.index.isin(trailing_months)]
        avg_monthly_expense = float(monthly_exp_series.mean()) if not monthly_exp_series.empty else 0.0

        pillars = []

        # 1. SAVINGS RATE (weight 30) — savings transfers as a share of income, 20% target == full marks
        recent_income = float(recent_df[recent_df['Type'] == 'Income']['Amount'].abs().sum())
        recent_savings = float(recent_df[recent_df['Type'] == 'Savings']['Amount'].abs().sum())
        if recent_income > 0:
            sr = recent_savings / recent_income * 100.0
            sr_score = _clamp(sr / 20.0 * 100.0)
            sr_detail = f"You're saving {sr:.0f}% of income (20% is the gold standard)."
        else:
            sr, sr_score = 0.0, 40.0
            sr_detail = "Not enough income recorded to gauge a savings rate."
        pillars.append({
            "key": "savings_rate", "label": "Savings Rate", "weight": 30,
            "score": round(sr_score), "value": f"{sr:.0f}%",
            "status": "good" if sr_score >= 75 else "warn" if sr_score >= 45 else "bad",
            "detail": sr_detail
        })

        # 2. CASH CUSHION (weight 20) — estimated liquid runway vs monthly burn, 6 months == full marks
        estimated_liquid = max(0.0, total_income - total_expense - total_savings)
        if avg_monthly_expense > 0:
            runway = estimated_liquid / avg_monthly_expense
            cc_score = _clamp(runway / 6.0 * 100.0)
            target_cushion = avg_monthly_expense * 6.0  # full-marks target = 6 months
            gap = target_cushion - estimated_liquid
            if gap > 0:
                cc_detail = (
                    f"You have ~${estimated_liquid:,.0f} ({runway:.1f} months). "
                    f"Aim for ${target_cushion:,.0f} (6 months at ${avg_monthly_expense:,.0f}/mo) "
                    f"— about ${gap:,.0f} more to go."
                )
            else:
                cc_detail = (
                    f"You have ~${estimated_liquid:,.0f} ({runway:.1f} months) — "
                    f"above the ${target_cushion:,.0f} target (6 months at ${avg_monthly_expense:,.0f}/mo). Solid."
                )
        else:
            runway, cc_score = 0.0, 60.0
            target_cushion = 0.0
            cc_detail = "No recurring expenses detected to size a cushion against."
        pillars.append({
            "key": "cash_cushion", "label": "Cash Cushion", "weight": 20,
            "score": round(cc_score), "value": f"{runway:.1f}mo",
            "target": round(target_cushion, 2),
            "status": "good" if cc_score >= 75 else "warn" if cc_score >= 45 else "bad",
            "detail": cc_detail
        })

        # 3. BUDGET ADHERENCE (weight 20) — how well the latest month respects set caps
        settings = get_settings()
        budgets = {k: v for k, v in settings.get("budgets", {}).items() if v and v > 0}
        if budgets and months:
            latest = months[-1]
            latest_exp = df[(df['Type'] == 'Expense') & (df['YearMonth'] == latest)]
            spent = latest_exp.groupby('Category')['Amount'].apply(lambda s: s.abs().sum()).to_dict()
            per_cat = []
            breached = 0
            for cat, cap in budgets.items():
                actual = float(spent.get(cat, 0.0))
                ratio = actual / cap
                if ratio > 1.0:
                    breached += 1
                # Full marks at/under budget; linear penalty up to 2x cap
                per_cat.append(_clamp(100.0 - max(0.0, ratio - 1.0) * 100.0))
            ba_score = sum(per_cat) / len(per_cat) if per_cat else 75.0
            ba_value = f"{len(budgets) - breached}/{len(budgets)} ok"
            ba_detail = (f"All {len(budgets)} budgets respected this month." if breached == 0
                         else f"{breached} of {len(budgets)} budget caps exceeded this month.")
        else:
            ba_score = 70.0
            ba_value = "Not set"
            ba_detail = "Set category budgets in Settings to sharpen this score."
        pillars.append({
            "key": "budget_adherence", "label": "Budget Adherence", "weight": 20,
            "score": round(ba_score), "value": ba_value,
            "status": "good" if ba_score >= 75 else "warn" if ba_score >= 45 else "bad",
            "detail": ba_detail
        })

        # 4. SUBSCRIPTION LOAD (weight 15) — recurring sub burden vs income; <=5% great, >=25% poor
        subs = detect_recurring_expenses()
        if person and person != "All Users":
            subs = [s for s in subs if s.get('person') == person]
        active_sub_burden = sum(s['monthly_burden'] for s in subs
                                if s.get('is_active') and s.get('flow_type') == 'Expense (Subscription)')
        monthly_income_est = (recent_income / max(1, len(recent_months))) if recent_income > 0 else 0.0
        if monthly_income_est > 0:
            sub_ratio = active_sub_burden / monthly_income_est
            sl_score = _clamp((1.0 - (sub_ratio - 0.05) / 0.20) * 100.0)
            sl_detail = f"${active_sub_burden:,.0f}/mo in subscriptions is {sub_ratio*100:.0f}% of income."
        else:
            sl_score = 70.0
            sl_detail = f"${active_sub_burden:,.0f}/mo in active subscriptions detected."
        pillars.append({
            "key": "subscription_load", "label": "Subscription Load", "weight": 15,
            "score": round(sl_score), "value": f"${active_sub_burden:,.0f}/mo",
            "status": "good" if sl_score >= 75 else "warn" if sl_score >= 45 else "bad",
            "detail": sl_detail
        })

        # 5. SPENDING STABILITY (weight 15) — month-over-month expense volatility (coefficient of variation)
        if len(monthly_exp_series) >= 2 and monthly_exp_series.mean() > 0:
            cv = float(monthly_exp_series.std(ddof=0) / monthly_exp_series.mean())
            # Full marks under 15% swing; zero by 75% swing (typical household variation lives between)
            ss_score = _clamp((1.0 - (cv - 0.15) / 0.60) * 100.0)
            ss_detail = f"Monthly spending swings about {cv*100:.0f}% around your average."
        else:
            cv = 0.0
            ss_score = 70.0
            ss_detail = "Need a couple of months of history to measure consistency."
        pillars.append({
            "key": "spending_stability", "label": "Spending Stability", "weight": 15,
            "score": round(ss_score), "value": f"{cv*100:.0f}% swing",
            "status": "good" if ss_score >= 75 else "warn" if ss_score >= 45 else "bad",
            "detail": ss_detail
        })

        # Attach a concrete, actionable tip to each pillar (shown when a pillar is expanded).
        pillar_tips = {
            "savings_rate": "Automate a transfer to savings or your brokerage on payday — saving before you can spend is the fastest lever here. Even +5% of income visibly moves this score.",
            "cash_cushion": "Route windfalls — refunds, bonuses, tax returns — straight to your cushion until you hit ~6 months of expenses, and avoid dipping in for non-emergencies.",
            "budget_adherence": "Tighten the categories you overshot, or raise caps that are unrealistically low so the budget reflects real life. Manage caps from the Active Monthly Budgets card.",
            "subscription_load": "Open the Subscriptions panel and cancel or pause the priciest one you don't use weekly. Annualize the cost — small monthly charges quietly add up.",
            "spending_stability": "Big irregular purchases drive the swings. Set up a monthly 'sinking fund' for known lumpy costs (travel, gifts, car) so month-to-month spending stays even.",
        }
        for p in pillars:
            p["tip"] = pillar_tips.get(p["key"], "")

        total_weight = sum(p['weight'] for p in pillars)
        score = round(sum(p['score'] * p['weight'] for p in pillars) / total_weight) if total_weight else 0

        if score >= 90:
            grade, label = "A", "Excellent"
        elif score >= 80:
            grade, label = "B", "Strong"
        elif score >= 70:
            grade, label = "C", "Fair"
        elif score >= 60:
            grade, label = "D", "Needs Work"
        else:
            grade, label = "F", "At Risk"

        # Headline summary names the weakest meaningful pillar
        weakest = min(pillars, key=lambda p: p['score'])
        if score >= 80:
            summary = f"Your finances are in {label.lower()} shape. Keep the momentum going."
        else:
            summary = f"Biggest opportunity: {weakest['label']}. {weakest['detail']}"

        return {
            "score": score, "grade": grade, "label": label,
            "summary": summary, "pillars": pillars, "available": True
        }
    except Exception as e:
        print(f"Error computing health score: {e}")
        return empty


@app.get("/api/wealth_insights")
def get_wealth_insights(person: Optional[str] = None, start_month: Optional[str] = None, end_month: Optional[str] = None):
    """Two wealth-building views:
      • contributions — Roth IRA / HSA contributions vs the annual cap, across a fixed
        3-year window (prior · current · next year). These are calendar-year by nature,
        so the dashboard date range does NOT filter them.
      • opportunityCost — what discretionary spending would be worth today if it had been
        invested instead (compounded to today at a nominal market rate). This DOES honour
        the dashboard's selected date range so it matches the timeline in view.
    """
    result = {"contributions": [], "opportunityCost": None, "available": False}
    if not os.path.exists(MASTER_DB_PATH):
        return result
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if df.empty:
            return result
        if person and person != "All Users":
            df = df[df['Person'] == person]
        if df.empty:
            return result

        df['dt'] = pd.to_datetime(df['Date'], errors='coerce')
        df = df[df['dt'].notna()]
        if df.empty:
            return result

        import datetime as _dt
        today = _dt.date.today()
        this_year = today.year

        settings = get_settings()
        limits = settings.get('contribution_limits') or {}
        default_limits = {"Roth IRA": 7000.0, "HSA": 4400.0}

        # --- Tax-advantaged contribution progress, broken out across a 3-year window:
        #     one year behind, the current year, and one year ahead. ---
        year_window = [this_year - 1, this_year, this_year + 1]
        contributions = []
        for cat in ("Roth IRA", "HSA"):
            cap = float(limits.get(cat, default_limits[cat]) or default_limits[cat])
            per_year = []
            for yr in year_window:
                yr_df = df[(df['Category'] == cat) & (df['dt'].dt.year == yr)]
                contributed = float(yr_df['Amount'].abs().sum())
                per_year.append({
                    "year": yr,
                    "contributed": round(contributed, 2),
                    "limit": round(cap, 2),
                    "remaining": round(max(0.0, cap - contributed), 2),
                    "percent": round(contributed / cap * 100, 1) if cap > 0 else 0.0,
                    "isCurrent": yr == this_year,
                })
            # Surface the current year at the top level for backward compatibility,
            # and attach the full per-year breakdown under "years".
            cur = next(p for p in per_year if p["year"] == this_year)
            contributions.append({
                "category": cat,
                "contributed": cur["contributed"],
                "limit": cur["limit"],
                "remaining": cur["remaining"],
                "percent": cur["percent"],
                "year": this_year,
                "years": per_year,
            })

        # --- Opportunity cost of discretionary spending (10% nominal, compounded to today) ---
        # Honour the dashboard's date range so this matches the timeline the user is viewing.
        range_start = start_month if start_month and start_month != "All Time" else None
        range_end = end_month if end_month and end_month != "All Time" else None
        oc_df = df
        if range_start or range_end:
            ym = df['dt'].dt.to_period('M').astype(str)
            mask = pd.Series(True, index=df.index)
            if range_start:
                mask &= ym >= range_start
            if range_end:
                mask &= ym <= range_end
            oc_df = df[mask]

        DISCRETIONARY = {'Dining', 'Shopping', 'Entertainment', 'Fun', 'Subscription'}
        RATE = 0.10
        disc = oc_df[oc_df['Category'].isin(DISCRETIONARY) & (oc_df['Amount'] < 0)].copy()
        opportunity = None
        if not disc.empty:
            disc['principal'] = disc['Amount'].abs()
            years = (pd.Timestamp(today) - disc['dt']).dt.days / 365.25
            years = years.clip(lower=0)
            disc['fv'] = disc['principal'] * (1.0 + RATE) ** years
            principal_total = float(disc['principal'].sum())
            fv_total = float(disc['fv'].sum())
            opportunity = {
                "principal": round(principal_total, 2),
                "futureValue": round(fv_total, 2),
                "gain": round(fv_total - principal_total, 2),
                "rate": RATE,
                "categories": sorted(DISCRETIONARY),
                "fromDate": str(disc['dt'].min().date()),
                "count": int(len(disc)),
            }

        return {"contributions": contributions, "opportunityCost": opportunity, "available": True}
    except Exception as e:
        print(f"Error computing wealth insights: {e}")
        return result


@app.get("/api/trends")
def get_trends(person: Optional[str] = None):
    """Month-over-month analytics: headline deltas, top category movers, sparklines and a 3-month-average baseline.
    Uses the last two *complete* months (the in-progress month is excluded so comparisons are apples-to-apples)."""
    empty = {"available": False, "currentMonth": None, "prevMonth": None, "metrics": [], "movers": [], "sparks": {"expenses": [], "income": []}}
    if not os.path.exists(MASTER_DB_PATH):
        return empty
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if df.empty:
            return empty
        if person and person != "All Users":
            df = df[df['Person'] == person]
        if df.empty:
            return empty

        df['YearMonth'] = pd.to_datetime(df['Date'], errors='coerce').dt.to_period('M').astype(str)
        df = df[df['YearMonth'] != 'NaT']

        cats = load_categories()
        income_cats = cats.get('Income', [])
        savings_cats = cats.get('Savings', [])
        transfer_cats = cats.get('Transfer', ['Transfer'])
        df['Type'] = 'Expense'
        df.loc[df['Category'].isin(income_cats) | ((df['Category'] == 'Uncategorized') & (df['Amount'] > 0)), 'Type'] = 'Income'
        df.loc[df['Category'].isin(savings_cats), 'Type'] = 'Savings'
        df.loc[df['Category'].isin(transfer_cats), 'Type'] = 'Transfer'

        import datetime as _dt
        current_period = _dt.date.today().strftime('%Y-%m')
        all_months = sorted(df['YearMonth'].dropna().unique())
        complete = [m for m in all_months if m < current_period] or all_months
        if len(complete) < 2:
            return empty

        cur, prev = complete[-1], complete[-2]
        baseline_months = complete[-4:-1]  # the 3 months before current

        def _sum(month, typ):
            return float(df[(df['YearMonth'] == month) & (df['Type'] == typ)]['Amount'].abs().sum())

        def _avg(typ):
            vals = [_sum(m, typ) for m in baseline_months]
            return float(sum(vals) / len(vals)) if vals else 0.0

        def _pct(c, p):
            if p == 0:
                return None
            return round((c - p) / p * 100, 1)

        cur_exp, prev_exp = _sum(cur, 'Expense'), _sum(prev, 'Expense')
        cur_inc, prev_inc = _sum(cur, 'Income'), _sum(prev, 'Income')
        cur_sav, prev_sav = _sum(cur, 'Savings'), _sum(prev, 'Savings')
        cur_net, prev_net = cur_inc - cur_exp, prev_inc - prev_exp
        cur_sr = round(cur_sav / cur_inc * 100, 1) if cur_inc > 0 else 0.0
        prev_sr = round(prev_sav / prev_inc * 100, 1) if prev_inc > 0 else 0.0

        metrics = [
            {"key": "expenses", "label": "Spending", "current": round(cur_exp, 2), "prev": round(prev_exp, 2),
             "delta_pct": _pct(cur_exp, prev_exp), "vs_avg_pct": _pct(cur_exp, _avg('Expense')),
             "unit": "$", "tone": "good" if cur_exp < prev_exp else "bad" if cur_exp > prev_exp else "neutral"},
            {"key": "income", "label": "Income", "current": round(cur_inc, 2), "prev": round(prev_inc, 2),
             "delta_pct": _pct(cur_inc, prev_inc), "vs_avg_pct": _pct(cur_inc, _avg('Income')),
             "unit": "$", "tone": "good" if cur_inc > prev_inc else "bad" if cur_inc < prev_inc else "neutral"},
            {"key": "net", "label": "Net Cashflow", "current": round(cur_net, 2), "prev": round(prev_net, 2),
             "delta_pct": _pct(cur_net, prev_net), "vs_avg_pct": None,
             "unit": "$", "tone": "good" if cur_net > prev_net else "bad" if cur_net < prev_net else "neutral"},
            {"key": "savings_rate", "label": "Savings Rate", "current": cur_sr, "prev": prev_sr,
             "delta_pp": round(cur_sr - prev_sr, 1), "vs_avg_pct": None,
             "unit": "%", "tone": "good" if cur_sr > prev_sr else "bad" if cur_sr < prev_sr else "neutral"},
        ]

        # Top category movers (expenses) — ranked by absolute dollar change
        exp = df[df['Type'] == 'Expense']
        cur_by_cat = exp[exp['YearMonth'] == cur].groupby('Category')['Amount'].apply(lambda s: s.abs().sum())
        prev_by_cat = exp[exp['YearMonth'] == prev].groupby('Category')['Amount'].apply(lambda s: s.abs().sum())
        all_cats = set(cur_by_cat.index) | set(prev_by_cat.index)
        movers = []
        for c in all_cats:
            cv = float(cur_by_cat.get(c, 0.0))
            pv = float(prev_by_cat.get(c, 0.0))
            if max(cv, pv) < 25:  # ignore noise
                continue
            movers.append({
                "category": str(c),
                "current": round(cv, 2),
                "prev": round(pv, 2),
                "delta_abs": round(cv - pv, 2),
                "delta_pct": _pct(cv, pv),
                "isNew": pv == 0 and cv > 0,
                "tone": "bad" if cv > pv else "good" if cv < pv else "neutral"
            })
        movers = sorted(movers, key=lambda x: -abs(x['delta_abs']))[:5]

        # Sparklines — last 6 complete months
        spark_months = complete[-6:]
        sparks = {
            "expenses": [{"month": m, "value": round(_sum(m, 'Expense'), 2)} for m in spark_months],
            "income": [{"month": m, "value": round(_sum(m, 'Income'), 2)} for m in spark_months],
        }

        return {"available": True, "currentMonth": cur, "prevMonth": prev, "metrics": metrics, "movers": movers, "sparks": sparks}
    except Exception as e:
        print(f"Error computing trends: {e}")
        return empty


@app.get("/api/accounts/summary")
def get_accounts_summary(person: Optional[str] = None):
    """Per-account transaction counts and date coverage, for the Data Pipeline tab to show ingestion state at a glance."""
    result = {"accounts": {}, "total_transactions": 0, "last_updated": None}
    if not os.path.exists(MASTER_DB_PATH):
        return result
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if df.empty:
            return result
        if 'Account' not in df.columns:
            df['Account'] = 'Legacy Account'
        if person and person != "All Users":
            df = df[df['Person'] == person]
        df['_d'] = pd.to_datetime(df['Date'], errors='coerce')
        accounts = {}
        for acct, grp in df.groupby('Account'):
            dmin = grp['_d'].min()
            dmax = grp['_d'].max()
            accounts[str(acct)] = {
                "count": int(len(grp)),
                "first_date": dmin.strftime('%Y-%m-%d') if pd.notna(dmin) else None,
                "last_date": dmax.strftime('%Y-%m-%d') if pd.notna(dmax) else None,
            }
        overall_max = df['_d'].max()
        result["accounts"] = accounts
        result["total_transactions"] = int(len(df))
        result["last_updated"] = overall_max.strftime('%Y-%m-%d') if pd.notna(overall_max) else None
        return result
    except Exception as e:
        print(f"Error building accounts summary: {e}")
        return result


@app.get("/api/ledger")
def get_ledger_data(person: Optional[str] = None):
    if not os.path.exists(MASTER_DB_PATH): return []
    df = pd.read_csv(MASTER_DB_PATH)
    
    # Filter by person if provided
    if person and person != "All Users":
        df = df[df['Person'] == person]
        
    # Ensure Dismissed_Categories column exists defensively
    if 'Dismissed_Categories' not in df.columns:
        df['Dismissed_Categories'] = ""
        
    uncat = df[df['Category'] == 'Uncategorized'].copy()
    
    # Retrain AI Model dynamically on each ledger call to capture continuous learning
    ai_model = train_categorizer()
    
    records = []
    if not uncat.empty:
        preds = []
        confidences = []
        
        if ai_model is not None:
            try:
                probs = ai_model.predict_proba(uncat['Description'])
                classes = list(ai_model.classes_)
                
                # Check for each row
                for i, (_, row) in enumerate(uncat.iterrows()):
                    row_probs = probs[i]
                    cat_probs = dict(zip(classes, row_probs))
                    
                    # Parse dismissed categories list
                    dismissed_str = str(row.get('Dismissed_Categories', ''))
                    dismissed = [c.strip().lower() for c in dismissed_str.split(',') if c.strip()]
                    
                    # Filter remaining category probabilities
                    remaining_cat_probs = {c: p for c, p in cat_probs.items() if c.lower() not in dismissed}
                    
                    if remaining_cat_probs:
                        # Find category with highest remaining probability
                        best_cat = max(remaining_cat_probs, key=remaining_cat_probs.get)
                        best_prob = float(remaining_cat_probs[best_cat])
                        
                        # Only suggest if probability is non-trivial (e.g. >= 0.05)
                        if best_prob >= 0.05:
                            preds.append(best_cat)
                            confidences.append(round(best_prob, 2))
                        else:
                            preds.append("Uncategorized")
                            confidences.append(0.0)
                    else:
                        preds.append("Uncategorized")
                        confidences.append(0.0)
            except Exception as pe:
                print(f"Prediction error in next-best-guess engine: {pe}")
                preds = ["Uncategorized"] * len(uncat)
                confidences = [0.0] * len(uncat)
        else:
            preds = ["Uncategorized"] * len(uncat)
            confidences = [0.0] * len(uncat)
            
        uncat['Suggested_Category'] = preds
        uncat['AI_Confidence'] = confidences
        
        # Sort so highest confidence is first, or by Date
        uncat = uncat.sort_values(by=['AI_Confidence', 'Date'], ascending=[False, False]).head(50).fillna("")
        
        for _, row in uncat.iterrows():
            records.append({
                "id": str(row['Transaction_ID']),
                "date": str(row['Date']),
                "details": str(row['Description']),
                "amount": float(row['Amount']),
                "type": "Income" if float(row['Amount']) > 0 else "Expense",
                "category": str(row['Suggested_Category']) if row['Suggested_Category'] != "Uncategorized" else "Uncategorized",
                "confidence": float(row['AI_Confidence']),
                "dismissed": str(row.get('Dismissed_Categories', '')),
                # Context to help the user categorize: which account/bank and whose profile
                "account": str(row.get('Account', '') or ''),
                "person": str(row.get('Person', '') or ''),
                "verified": False
            })
    return records

@app.get("/api/ledger/categorized")
def get_categorized_ledger_data(search: Optional[str] = None, person: Optional[str] = None):
    if not os.path.exists(MASTER_DB_PATH): return []
    df = pd.read_csv(MASTER_DB_PATH)
    
    # Filter by person if provided
    if person and person != "All Users":
        df = df[df['Person'] == person]
        
    # Isolate categorized transactions
    cat_df = df[df['Category'] != 'Uncategorized'].copy()
    
    if search:
        search_lower = search.lower()
        cat_df = cat_df[cat_df['Description'].str.lower().str.contains(search_lower, na=False) | cat_df['Category'].str.lower().str.contains(search_lower, na=False)]
        
    # Sort by Date descending and limit to top 150 for performance
    cat_df = cat_df.sort_values(by='Date', ascending=False).head(150).fillna("")
    
    records = []
    for _, row in cat_df.iterrows():
        records.append({
            "id": str(row['Transaction_ID']),
            "date": str(row['Date']),
            "details": str(row['Description']),
            "amount": float(row['Amount']),
            "type": "Income" if float(row['Amount']) > 0 else "Expense",
            "category": str(row['Category']),
            "account": str(row.get('Account', 'Unknown')),
            "person": str(row.get('Person', 'Unknown')),
            "verified": True
        })
    return records

@app.post("/api/ledger/confirm")
def confirm_ledger_row(update: LedgerUpdate):
    if not os.path.exists(MASTER_DB_PATH): return {"status": "error", "message": "Master database not found"}
    df = pd.read_csv(MASTER_DB_PATH)
    if 'Verified' not in df.columns:
        df['Verified'] = False

    # Update the Master DB
    mask = df['Transaction_ID'].astype(str) == update.transaction_id
    if mask.any():
        df.loc[mask, 'Category'] = update.category
        # Lock in the manual choice so the startup sweep can't revert it.
        df.loc[mask, 'Verified'] = True

        # CONTINUOUS LEARNING: Save rule to merchant_rules.csv
        raw_desc = df.loc[mask, 'Description'].iloc[0]
        clean_merchant = extract_core_merchant(raw_desc)
        person = df.loc[mask, 'Person'].iloc[0]

        # AGGRESSIVE PROPAGATION: Automatically update all past matching Uncategorized descriptions!
        merchant_mask = df['Description'].apply(extract_core_merchant) == clean_merchant
        uncat_mask = df['Category'] == 'Uncategorized'
        person_mask = df['Person'] == person
        sweep_mask = merchant_mask & uncat_mask & person_mask
        if sweep_mask.any():
            df.loc[sweep_mask, 'Category'] = update.category
            df.loc[sweep_mask, 'Verified'] = True
            print(f"🧹 Aggressive Sweep ({person}): Retroactively categorized {sweep_mask.sum()} instances of {clean_merchant} to {update.category}")
            
        save_master_df(df)
        
        # Highly defensive rules persistence to prevent KeyErrors
        rules = load_custom_rules()
        rules[clean_merchant] = update.category
        
        rows = []
        for merch, cat in rules.items():
            if merch and cat:
                rows.append({"Merchant": str(merch), "Category": str(cat)})
        pd.DataFrame(rows, columns=['Merchant', 'Category']).to_csv(RULES_PATH, index=False)
        
    return {"status": "success"}

@app.post("/api/ledger/confirm_all")
def confirm_ledger_all(bulk: BulkLedgerUpdate):
    if not os.path.exists(MASTER_DB_PATH): return {"status": "error", "message": "Master database not found"}
    df = pd.read_csv(MASTER_DB_PATH)
    if 'Verified' not in df.columns:
        df['Verified'] = False

    custom_rules = load_custom_rules()
    updated_rules = False

    for update in bulk.updates:
        mask = df['Transaction_ID'].astype(str) == update.transaction_id
        if mask.any() and update.category != 'Uncategorized':
            df.loc[mask, 'Category'] = update.category
            # Lock in the manual choice so the startup sweep can't revert it.
            df.loc[mask, 'Verified'] = True

            # Save rule to merchant_rules.csv
            raw_desc = df.loc[mask, 'Description'].iloc[0]
            clean_merchant = extract_core_merchant(raw_desc)
            person = df.loc[mask, 'Person'].iloc[0]

            # Aggressive Propagation: Automatically update all past matching Uncategorized descriptions
            merchant_mask = df['Description'].apply(extract_core_merchant) == clean_merchant
            uncat_mask = df['Category'] == 'Uncategorized'
            person_mask = df['Person'] == person
            sweep_mask = merchant_mask & uncat_mask & person_mask
            if sweep_mask.any():
                df.loc[sweep_mask, 'Category'] = update.category
                df.loc[sweep_mask, 'Verified'] = True

            custom_rules[clean_merchant] = update.category
            updated_rules = True
            
    save_master_df(df)
    
    if updated_rules:
        rows = []
        for merch, cat in custom_rules.items():
            if merch and cat:
                rows.append({"Merchant": str(merch), "Category": str(cat)})
        pd.DataFrame(rows, columns=['Merchant', 'Category']).to_csv(RULES_PATH, index=False)
        
    return {"status": "success", "message": f"Successfully verified {len(bulk.updates)} transactions in bulk!"}

@app.post("/api/ledger/recategorize")
def recategorize_single(update: SingleRecategorize):
    """Recategorizes EXACTLY ONE transaction — no merchant-wide sweep, no saved rule.

    Used by the recurring-cashflow payment history, where the same vendor can legitimately
    span multiple categories, so propagating to every matching transaction would be wrong.
    """
    if not os.path.exists(MASTER_DB_PATH):
        return {"status": "error", "message": "Master database not found"}
    try:
        with _write_lock:
            df = pd.read_csv(MASTER_DB_PATH)
            if 'Verified' not in df.columns:
                df['Verified'] = False
            mask = df['Transaction_ID'].astype(str) == str(update.transaction_id)
            if not mask.any():
                return {"status": "error", "message": "Transaction not found."}
            df.loc[mask, 'Category'] = update.category
            # Lock in the manual choice so the startup sweep can't revert it.
            df.loc[mask, 'Verified'] = True
            save_master_df(df)
        return {"status": "success", "message": f"Recategorized to {update.category}."}
    except Exception as e:
        return {"status": "error", "message": f"Recategorize failed: {str(e)}"}

@app.post("/api/ledger/recategorize_scope")
def recategorize_scope(update: ScopedRecategorize):
    """Recategorizes a charge with a chosen blast radius:

      • "one"  — exactly this transaction (same as /ledger/recategorize).
      • "year" — every charge from the same core merchant + person within the same
                 calendar year as the anchor charge. This answers "for 2026, every
                 $625 SCHWAB BROKERAGE DES is a Roth IRA" without touching other years.
      • "all"  — all-time for that merchant + person, and persists a merchant rule so
                 future imports inherit the category.
    """
    if not os.path.exists(MASTER_DB_PATH):
        return {"status": "error", "message": "Master database not found"}
    try:
        with _write_lock:
            df = pd.read_csv(MASTER_DB_PATH)
            if 'Verified' not in df.columns:
                df['Verified'] = False
            anchor = df['Transaction_ID'].astype(str) == str(update.transaction_id)
            if not anchor.any():
                return {"status": "error", "message": "Transaction not found."}

            if update.scope == "one":
                df.loc[anchor, 'Category'] = update.category
                df.loc[anchor, 'Verified'] = True
                save_master_df(df)
                return {"status": "success", "count": 1,
                        "message": f"Recategorized to {update.category}."}

            # Identify the merchant + person from the anchor charge.
            raw_desc = df.loc[anchor, 'Description'].iloc[0]
            clean_merchant = extract_core_merchant(raw_desc)
            person = df.loc[anchor, 'Person'].iloc[0]
            merchant_mask = df['Description'].apply(extract_core_merchant) == clean_merchant
            person_mask = df['Person'] == person
            sweep_mask = merchant_mask & person_mask

            label = clean_merchant
            if update.scope == "year":
                anchor_date = pd.to_datetime(df.loc[anchor, 'Date'].iloc[0], errors='coerce')
                if pd.isna(anchor_date):
                    return {"status": "error", "message": "Charge has no valid date to scope a year."}
                year = int(anchor_date.year)
                year_mask = pd.to_datetime(df['Date'], errors='coerce').dt.year == year
                sweep_mask = sweep_mask & year_mask
                label = f"{clean_merchant} in {year}"

            df.loc[sweep_mask, 'Category'] = update.category
            df.loc[sweep_mask, 'Verified'] = True
            count = int(sweep_mask.sum())
            save_master_df(df)

            # "all" also persists a durable merchant rule for future imports.
            if update.scope == "all":
                rules = load_custom_rules()
                rules[clean_merchant] = update.category
                rows = [{"Merchant": str(m), "Category": str(c)} for m, c in rules.items() if m and c]
                pd.DataFrame(rows, columns=['Merchant', 'Category']).to_csv(RULES_PATH, index=False)

        return {"status": "success", "count": count,
                "message": f"Recategorized {count} {label} charge{'s' if count != 1 else ''} to {update.category}."}
    except Exception as e:
        return {"status": "error", "message": f"Scoped recategorize failed: {str(e)}"}

@app.post("/api/ledger/dismiss")
def dismiss_ledger_row_category(dismiss: LedgerDismiss):
    if not os.path.exists(MASTER_DB_PATH):
        return {"status": "error", "message": "Master database not found"}
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        
        # Ensure column exists
        if 'Dismissed_Categories' not in df.columns:
            df['Dismissed_Categories'] = ""
            
        mask = df['Transaction_ID'].astype(str) == dismiss.transaction_id
        if mask.any():
            current_dismissed = str(df.loc[mask, 'Dismissed_Categories'].iloc[0])
            dismiss_list = [c.strip() for c in current_dismissed.split(',') if c.strip()]
            
            new_dismiss = dismiss.dismissed_category.strip()
            if new_dismiss not in dismiss_list:
                dismiss_list.append(new_dismiss)
                
            df.loc[mask, 'Dismissed_Categories'] = ",".join(dismiss_list)
            save_master_df(df)
            
            return {"status": "success", "message": f"Successfully dismissed category '{dismiss.dismissed_category}' for this transaction. It will be recycled to the next best prediction."}
            
        return {"status": "error", "message": "Transaction not found."}
    except Exception as e:
        return {"status": "error", "message": f"Dismissal failed: {str(e)}"}

@app.get("/api/ledger/conflicts")
def get_ledger_conflicts(person: Optional[str] = None):
    if not os.path.exists(MASTER_DB_PATH):
        return []
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if df.empty:
            return []
            
        # Filter by person if provided
        if person and person != "All Users":
            df = df[df['Person'] == person]
            
        if df.empty:
            return []
            
        # Isolate categorized transactions
        valid_df = df[df['Category'] != 'Uncategorized'].copy()
        if valid_df.empty:
            return []
            
        # Extract core merchant for each
        valid_df['Core_Merchant'] = valid_df['Description'].apply(extract_core_merchant)
        
        # Load whitelisted merchants
        whitelist = load_whitelisted_merchants()
        
        # Group by Core_Merchant and Category, count them
        grouped = valid_df.groupby(['Core_Merchant', 'Category']).size().reset_index(name='Count')
        
        # Find core merchants with > 1 unique category
        merchant_cat_counts = grouped.groupby('Core_Merchant')['Category'].nunique()
        conflict_merchants = merchant_cat_counts[merchant_cat_counts > 1].index.tolist()
        
        conflicts = []
        for merchant in conflict_merchants:
            # Skip if whitelisted
            if merchant.upper() in whitelist:
                continue
                
            merchant_df = grouped[grouped['Core_Merchant'] == merchant]
            
            # Build category distribution
            distribution = []
            for _, row in merchant_df.iterrows():
                distribution.append({
                    "category": str(row['Category']),
                    "count": int(row['Count'])
                })
                
            # Get details of some transactions causing the conflict
            sample_txs = valid_df[valid_df['Core_Merchant'] == merchant][['Transaction_ID', 'Date', 'Description', 'Amount', 'Category']].head(8).to_dict(orient='records')
            
            conflicts.append({
                "merchant": merchant,
                "distribution": distribution,
                "transactions": sample_txs
            })
            
        return conflicts
    except Exception as e:
        print(f"Error scanning conflicts: {e}")
        return []

@app.post("/api/ledger/conflicts/whitelist")
def whitelist_conflict(whitelist_item: ConflictWhitelist):
    try:
        save_whitelisted_merchant(whitelist_item.merchant)
        return {"status": "success", "message": f"Successfully whitelisted '{whitelist_item.merchant}' as a multi-category merchant! It will no longer trigger consistency warnings."}
    except Exception as e:
        return {"status": "error", "message": f"Whitelisting failed: {str(e)}"}

@app.post("/api/ledger/conflicts/resolve")
def resolve_conflict(resolution: ConflictResolution):
    if not os.path.exists(MASTER_DB_PATH):
        return {"status": "error", "message": "Master database not found"}
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        df['Core_Merchant'] = df['Description'].apply(extract_core_merchant)
        
        # Force all transactions with this core merchant to target_category
        mask = (df['Core_Merchant'] == resolution.merchant) & (df['Category'] != 'Uncategorized')
        updated_count = mask.sum()
        
        if updated_count > 0:
            df.loc[mask, 'Category'] = resolution.target_category
            df.drop(columns=['Core_Merchant'], inplace=True)
            save_master_df(df)
            
            # Save/Update rule to merchant_rules.csv
            rules = load_custom_rules()
            rules[resolution.merchant] = resolution.target_category
            
            rows = []
            for merch, cat in rules.items():
                if merch and cat:
                    rows.append({"Merchant": str(merch), "Category": str(cat)})
            pd.DataFrame(rows, columns=['Merchant', 'Category']).to_csv(RULES_PATH, index=False)
            
            return {"status": "success", "message": f"Successfully updated {updated_count} transactions for {resolution.merchant} to {resolution.target_category}!"}
        return {"status": "error", "message": "No transactions found to update."}
    except Exception as e:
        return {"status": "error", "message": f"Resolution failed: {str(e)}"}

@app.get("/api/maintenance/duplicates")
def get_duplicate_candidates(person: Optional[str] = None):
    """Flags EXACT duplicate transactions WITHOUT deleting anything.

    The ingest dedup keys on a hash of Date+Description+Amount, but rows that were ingested
    before description normalization (or via a different id scheme) can end up byte-identical
    yet carry different Transaction_IDs, so they survive. This finds only rows that match on
    ALL of person + date + description + amount — true duplicates, not merely similar charges.
    A merchant the user legitimately hit twice in a day with a different description (or a
    coincidental same-amount charge elsewhere) is never flagged.
    """
    empty = {"groups": [], "summary": {"groups": 0, "removable": 0}}
    if not os.path.exists(MASTER_DB_PATH):
        return empty
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if df.empty:
            return empty
        if 'Account' not in df.columns:
            df['Account'] = 'Legacy Account'
        if person and person != "All Users":
            df = df[df['Person'] == person]
        if df.empty:
            return empty

        df = df.reset_index(drop=True)
        df['_amt'] = pd.to_numeric(df['Amount'], errors='coerce').round(2)
        df['_desc'] = df['Description'].astype(str)

        groups = []
        removable = 0
        # Exact match on every identifying field. Anything less is not treated as a duplicate.
        for (per, date, amt, desc), grp in df.groupby(['Person', 'Date', '_amt', '_desc']):
            if len(grp) < 2 or amt == 0 or pd.isna(amt):
                continue
            txs = []
            for _, r in grp.iterrows():
                txs.append({
                    "id": str(r['Transaction_ID']),
                    "date": str(r['Date']),
                    "description": str(r['Description']),
                    "amount": float(r['Amount']),
                    "category": str(r.get('Category', '')),
                    "account": str(r.get('Account', '')),
                    "person": str(r.get('Person', '')),
                })
            # Distinct Transaction_IDs only — identical rows that share an id are the same record.
            seen = set()
            unique_txs = []
            for t in txs:
                if t['id'] not in seen:
                    seen.add(t['id'])
                    unique_txs.append(t)
            if len(unique_txs) < 2:
                continue
            # Keep the first row; everything after it is a removal candidate. Prefer keeping a
            # categorized row over an Uncategorized one when possible.
            order = sorted(range(len(unique_txs)),
                           key=lambda i: (unique_txs[i]['category'] == 'Uncategorized', i))
            keep_id = unique_txs[order[0]]['id']
            suggested_remove = [t['id'] for t in unique_txs if t['id'] != keep_id]
            removable += len(suggested_remove)

            groups.append({
                "person": str(per),
                "date": str(date),
                "amount": float(amt),
                "merchant": str(desc),
                "confidence": "exact",
                "keep_id": keep_id,
                "suggested_remove": suggested_remove,
                "transactions": unique_txs,
            })

        # Largest dollar amount first (biggest impact on top)
        groups.sort(key=lambda g: -abs(g['amount']))
        return {
            "groups": groups,
            "summary": {"groups": len(groups), "removable": removable},
        }
    except Exception as e:
        print(f"Error scanning duplicates: {e}")
        return empty

@app.post("/api/maintenance/duplicates/remove")
def remove_duplicates(payload: DuplicateRemoval):
    """Deletes exactly the transaction IDs the user selected. Never deletes on its own."""
    if not os.path.exists(MASTER_DB_PATH):
        return {"status": "error", "message": "Master database not found"}
    ids = {str(t).strip() for t in payload.transaction_ids if str(t).strip()}
    if not ids:
        return {"status": "error", "message": "No transaction IDs supplied."}
    try:
        with _write_lock:
            df = pd.read_csv(MASTER_DB_PATH)
            before = len(df)
            mask = df['Transaction_ID'].astype(str).isin(ids)
            removed = int(mask.sum())
            if removed == 0:
                return {"status": "info", "message": "None of the supplied IDs were found.", "removed": 0}
            df = df[~mask]
            save_master_df(df)
        print(f"🧹 Duplicate cleanup: removed {removed} of {before} transactions.")
        return {"status": "success", "message": f"Removed {removed} duplicate transaction(s).", "removed": removed}
    except Exception as e:
        return {"status": "error", "message": f"Removal failed: {str(e)}"}

@app.get("/api/rules")
def get_smart_rules():
    """Returns all smart conditional rules, each annotated with how many transactions it currently matches."""
    rules = load_smart_rules()
    for r in rules:
        r["match_count"] = _count_rule_matches(r)
    return rules

@app.post("/api/rules")
def create_smart_rule(rule: SmartRuleModel):
    """Creates a smart rule and immediately applies all rules to the master database."""
    try:
        if not rule.keyword.strip() or not rule.category.strip():
            return {"status": "error", "message": "Keyword and category are required."}
        rules = load_smart_rules()
        import uuid
        new_rule = rule.dict()
        new_rule["id"] = uuid.uuid4().hex[:12]
        rules.append(new_rule)
        save_smart_rules(rules)
        changed = apply_smart_rules_to_master()
        return {"status": "success", "message": f"Rule saved and applied — {changed} transaction(s) updated.", "changed": changed}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.delete("/api/rules/{rule_id}")
def delete_smart_rule(rule_id: str):
    try:
        rules = load_smart_rules()
        rules = [r for r in rules if r.get("id") != rule_id]
        save_smart_rules(rules)
        return {"status": "success", "message": "Rule deleted."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/rules/apply")
def apply_all_smart_rules():
    changed = apply_smart_rules_to_master()
    return {"status": "success", "message": f"Re-applied all rules — {changed} transaction(s) updated.", "changed": changed}

@app.get("/api/transactions/search")
def search_transactions(q: Optional[str] = None, person: Optional[str] = None, limit: int = 80):
    """Searches the master DB by keyword in the description, returning matches plus a sign/category breakdown
    so the user can see how the same keyword splits across income/expense and categories."""
    empty = {"matches": [], "summary": {"total": 0, "positive": 0, "negative": 0, "categories": []}}
    if not os.path.exists(MASTER_DB_PATH) or not q or not q.strip():
        return empty
    try:
        df = pd.read_csv(MASTER_DB_PATH)
        if person and person != "All Users":
            df = df[df['Person'] == person]
        if df.empty:
            return empty

        mask = df['Description'].astype(str).str.contains(re.escape(q.strip()), case=False, na=False)
        m = df[mask].copy()
        if m.empty:
            return empty

        amt = pd.to_numeric(m['Amount'], errors='coerce').fillna(0)
        total = len(m)
        positive = int((amt > 0).sum())
        negative = int((amt < 0).sum())
        cat_counts = m['Category'].astype(str).value_counts()
        categories = [{"name": str(k), "count": int(v)} for k, v in cat_counts.items()]

        m['_d'] = pd.to_datetime(m['Date'], errors='coerce')
        m = m.sort_values('_d', ascending=False).head(limit)
        matches = []
        for _, r in m.iterrows():
            matches.append({
                "id": str(r['Transaction_ID']),
                "date": str(r['Date']),
                "description": str(r['Description']),
                "amount": float(r['Amount']),
                "category": str(r['Category']),
                "account": str(r.get('Account', '')),
                "person": str(r.get('Person', ''))
            })
        return {"matches": matches, "summary": {"total": total, "positive": positive, "negative": negative, "categories": categories}}
    except Exception as e:
        print(f"Error searching transactions: {e}")
        return empty


@app.post("/api/pipeline/run")
def run_folder_pipeline():
    """Scans all dynamic user profiles under data/users/ for manually dropped raw bank/card statements and processes them."""
    if not os.path.exists(USER_ROOT):
        return {"status": "error", "message": "Users root directory not found."}
        
    try:
        custom_rules = load_custom_rules()
        new_dataframes = []
        processed_files = []
        
        people = [d for d in os.listdir(USER_ROOT) if os.path.isdir(os.path.join(USER_ROOT, d))]
        
        for person in people:
            person_raw_root = os.path.join(USER_ROOT, person, "raw")
            person_archive_dir = os.path.join(USER_ROOT, person, "archive")
            os.makedirs(person_archive_dir, exist_ok=True)
            
            for subfolder in ['banking', 'bank', 'credit_cards', 'credit_card']:
                folder_path = os.path.join(person_raw_root, subfolder)
                if not os.path.exists(folder_path):
                    continue
                    
                for file in os.listdir(folder_path):
                    if file.lower().endswith('.csv'):
                        filepath = os.path.join(folder_path, file)
                        
                        try:
                            # 1. Standardize and clean
                            df_new = clean_bank_csv(filepath)
                            df_new['Person'] = person
                            df_new['Category'] = 'Uncategorized'
                            df_new['Dismissed_Categories'] = ""
                            
                            # Intelligently extract card name
                            account_name = os.path.splitext(file)[0].replace('_', ' ').replace('-', ' ').title()
                            df_new['Account'] = account_name
                            
                            # Apply rules
                            if custom_rules:
                                clean_desc = df_new['Description'].apply(extract_core_merchant)
                                df_new['Category'] = clean_desc.map(custom_rules).fillna('Uncategorized')
                                
                            if subfolder in ['credit_cards', 'credit_card']:
                                df_new['Amount'] = df_new['Amount'].abs() * -1
                                
                            new_dataframes.append(df_new)
                            processed_files.append(f"{person}/{subfolder}/{file}")
                            
                            # 2. Symmetrically compress and archive to Gzip to save space
                            import gzip
                            archive_path = os.path.join(person_archive_dir, file + ".gz")
                            with open(filepath, 'rb') as f_in:
                                with gzip.open(archive_path, 'wb') as f_out:
                                    shutil.copyfileobj(f_in, f_out)
                                    
                            os.remove(filepath)
                            
                        except Exception as fe:
                            print(f"Error processing dropped file {file}: {fe}")
                            if os.path.exists(filepath):
                                os.remove(filepath)
                                
        if not new_dataframes:
            return {"status": "info", "message": "No new manually dropped statement CSV files found in dynamic user raw/ directories.", "processed": []}
            
        # Merge new frames into master DB
        df_combined_new = pd.concat(new_dataframes)
        if os.path.exists(MASTER_DB_PATH):
            df_master = pd.read_csv(MASTER_DB_PATH)
            # Deduplicate by Transaction_ID, keeping the last one (or first one)
            df_final = pd.concat([df_master, df_combined_new]).drop_duplicates(subset=['Transaction_ID'], keep='last')
        else:
            df_final = df_combined_new
            
        save_master_df(df_final)
        
        # Run startup sweeps on the master DB for instant cleanup
        auto_categorize_master_db()
        apply_smart_rules_to_master()

        return {"status": "success", "message": f"Successfully parsed and ingested {len(processed_files)} dropped statement CSV file(s) into database!", "processed": processed_files}
    except Exception as e:
        return {"status": "error", "message": f"Pipeline execution failed: {str(e)}"}

@app.post("/api/ledger/sync")
def sync_with_excel_history():
    if not os.path.exists(EXCEL_HISTORY_PATH):
        return {"status": "info", "message": "No legacy history file found. System will learn from your manual entries instead!"}
    if not os.path.exists(MASTER_DB_PATH): return {"status": "error", "message": "Master DB is empty."}
        
    try:
        hist = pd.read_excel(EXCEL_HISTORY_PATH, skiprows=11)
        hist.columns = [c.strip() for c in hist.columns]
        excel_map = dict(zip(hist['Details'].apply(extract_core_merchant), hist['Categories']))
        
        df_master = pd.read_csv(MASTER_DB_PATH)
        uncat_mask = df_master['Category'] == 'Uncategorized'
        if not uncat_mask.any(): return {"status": "info", "message": "No uncategorized records left to sync.", "matched": 0}
            
        clean_descriptions = df_master.loc[uncat_mask, 'Description'].apply(extract_core_merchant)
        matches = clean_descriptions.map(excel_map)
        matched_count = matches.notna().sum()
        
        df_master.loc[uncat_mask, 'Category'] = matches.fillna('Uncategorized')
        save_master_df(df_master)
        
        return {"status": "success", "message": f"Successfully learned from legacy data! Auto-categorized {matched_count} transactions.", "matched": int(matched_count)}
    except Exception as e:
        return {"status": "error", "message": f"Could not read excel file: {str(e)}"}

# ----------------------------------------------------------------------------
#  PLAID — let each local profile connect its own bank institutions and pull
#  transactions straight into the master ledger (same pipeline as CSV upload).
# ----------------------------------------------------------------------------
@app.get("/api/plaid/status")
def plaid_status():
    """Reports whether Plaid credentials are configured and which environment is active."""
    return {
        "configured": plaid_service.is_configured(),
        "environment": (os.environ.get("PLAID_ENV") or "production").lower(),
    }

@app.post("/api/plaid/create_link_token")
def plaid_create_link_token(req: PlaidLinkTokenRequest):
    try:
        token = plaid_service.create_link_token(req.person)
        return {"status": "success", "link_token": token}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/plaid/exchange_public_token")
def plaid_exchange_public_token(req: PlaidExchangeRequest):
    try:
        info = plaid_service.exchange_public_token(
            req.public_token, req.person, req.institution_name
        )
        return {"status": "success", **info}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/plaid/items")
def plaid_list_items(person: Optional[str] = None):
    try:
        return {"status": "success", "items": plaid_service.list_items(person)}
    except Exception as e:
        return {"status": "error", "message": str(e), "items": []}

@app.delete("/api/plaid/items/{item_id}")
def plaid_remove_item(item_id: str):
    try:
        removed = plaid_service.remove_item(item_id)
        if removed:
            return {"status": "success", "message": "Bank connection removed."}
        return {"status": "error", "message": "Connection not found."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/plaid/sync")
def plaid_sync(req: PlaidSyncRequest):
    """Pulls new/updated transactions from connected banks and merges them into the ledger."""
    try:
        added_rows, removed_ids, summary = plaid_service.fetch_new_transactions(req.person)

        # Enforce the cutover: drop any imported transaction dated on/before it, so
        # Plaid's backfill can't overlap the CSV history that precedes the switch.
        cutover = (get_settings().get("plaid_cutover_date") or "").strip()
        if cutover and added_rows:
            kept = [r for r in added_rows if str(r.get("Date", "")) >= cutover]
            dropped = len(added_rows) - len(kept)
            if dropped:
                print(f"⏮️  Plaid cutover: skipped {dropped} transaction(s) on/before {cutover}.")
            added_rows = kept

        if not added_rows and not removed_ids:
            return {
                "status": "info",
                "message": "No new transactions to sync.",
                "added": 0,
                "summary": summary,
            }

        # Merge into the master ledger, mirroring the CSV upload path.
        if os.path.exists(MASTER_DB_PATH):
            df_master = pd.read_csv(MASTER_DB_PATH)
            if 'Account' not in df_master.columns:
                df_master['Account'] = 'Legacy Account'
        else:
            df_master = pd.DataFrame(columns=plaid_service.LEDGER_COLUMNS)

        if added_rows:
            df_new = pd.DataFrame(added_rows, columns=plaid_service.LEDGER_COLUMNS)
            df_final = pd.concat([df_master, df_new]).drop_duplicates(
                subset=['Transaction_ID'], keep='last'
            )
        else:
            df_final = df_master

        # Drop transactions Plaid reports as removed (e.g. pending that never posted).
        if removed_ids:
            df_final = df_final[~df_final['Transaction_ID'].isin(removed_ids)]

        save_master_df(df_final)

        # Let the existing engine categorize the freshly imported rows.
        auto_categorize_master_db()
        apply_smart_rules_to_master()

        return {
            "status": "success",
            "message": f"Synced {len(added_rows)} transaction(s) from connected banks.",
            "added": len(added_rows),
            "removed": len(removed_ids),
            "summary": summary,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# Seed merchant rules, backfill uncategorized transactions, and compress legacy archives on import
seed_merchant_rules()
auto_categorize_master_db()
apply_smart_rules_to_master()
compress_existing_archives()