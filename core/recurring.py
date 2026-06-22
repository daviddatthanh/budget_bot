import pandas as pd
import os
import sys
from datetime import datetime

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

MASTER_DB_PATH = "data/master_transactions.csv"
RECURRING_DB_PATH = "data/processed/recurring_subscriptions.csv"

def extract_core_merchant(desc):
    import re
    if pd.isna(desc): return "UNKNOWN"
    
    desc_upper = str(desc).upper()
    if "AMAZON PRIME" in desc_upper or "AMZN PRIME" in desc_upper or "AMZNPRIME" in desc_upper:
        return "AMAZON PRIME"
    if "GOOGLE FI" in desc_upper or "GOOGLE *FI" in desc_upper or "GOOGLE*FI" in desc_upper:
        return "GOOGLE FI"
    if "NETFLIX" in desc_upper:
        return "NETFLIX"
    if "SPOTIFY" in desc_upper:
        return "SPOTIFY"
    if "STARBUCKS" in desc_upper:
        return "STARBUCKS"
    if "CLASSPASS" in desc_upper:
        # Statements vary the suffix ("CLASSPASS MONTHLY", "CLASSPASS MONTHLY MISSOULA"),
        # which would otherwise split one subscription across multiple merchant keys.
        return "CLASSPASS"
    if "WALMART" in desc_upper or "WM SUPERCENTER" in desc_upper or "WAL-MART" in desc_upper:
        return "WALMART"
    if "CHASE AUTOPAY" in desc_upper or "CHASE AUTO-PMT" in desc_upper:
        return "CHASE AUTOPAY"
    if "DISCOVER" in desc_upper and ("PYMT" in desc_upper or "PAYMENT" in desc_upper or "AUTOPAY" in desc_upper):
        return "DISCOVER PYMT"
    if "CAPITAL ONE" in desc_upper and ("AUTOPAY" in desc_upper or "CRCARDPMT" in desc_upper or "PYMT" in desc_upper):
        return "CAPITAL ONE AUTOPAY"
    if "WEALTHFRONT" in desc_upper:
        return "WEALTHFRONT"
    if "FID BKG SVC" in desc_upper or "FIDELITY" in desc_upper:
        return "FIDELITY"
        
    clean = re.sub(r'(?i)null\s*[X\d]+|#\s*\d+|[*\d]+', ' ', str(desc))
    noise = r'\b(IN|CA|MI|NY|TX|FL|MD|MT|OR|WA|NV|CLEARED|PENDING|TROY|IRVINE|TUSTIN)\b'
    clean = re.sub(noise, ' ', clean, flags=re.IGNORECASE)
    clean = re.sub(r'[^A-Z\s]', ' ', clean.upper())
    words = clean.split()
    return " ".join(words[:3]) if len(words) >= 3 else " ".join(words)

def load_categories():
    default_cats = {
        'Income': ['Salary', 'Zelle Transfers', 'Wages', 'Income', 'Rewards', 'Refunds'],
        'Savings': ['Emergency Fund', 'Brokerage', 'Crypto', 'Investments'],
        'Expense': ['Dining', 'Groceries', 'Gas', 'Merchandise', 'Travel', 'Housing', 'Bills', 'Personal Growth Expenses', 'Debt', 'Uncategorized'],
        'Transfer': ['Transfer', 'Credit Card Payment', 'Card Payment', 'CC Payment', 'CC payment']
    }
    
    # Sort default categories alphabetically
    for key in default_cats:
        default_cats[key] = sorted(list(set(default_cats[key])), key=lambda s: s.lower())
        
    categories_path = "data/user_categories.csv"
    if not os.path.exists(categories_path):
        return default_cats
    try:
        df = pd.read_csv(categories_path)
        categories = {'Income': [], 'Expense': [], 'Savings': [], 'Transfer': []}
        for _, row in df.iterrows():
            cat = str(row['Category']).strip()
            t = str(row['Type']).strip()
            t_cap = t.capitalize()
            if t_cap not in categories:
                categories[t_cap] = []
            categories[t_cap].append(cat)
            
        # Dynamically merge loaded categories with defaults
        for key in default_cats:
            if key not in categories:
                categories[key] = []
            merged_set = set(categories[key]) | set(default_cats[key])
            categories[key] = sorted(list(merged_set), key=lambda s: s.lower())
        return categories
    except:
        # Fallback to merging what we can
        return default_cats

# In-memory cache so repeated calls within a single dashboard load (subscriptions,
# savings_advisor, health_score all call this) don't recompute the full groupby.
# Invalidated automatically whenever master_transactions.csv changes on disk.
_recurring_cache = {"mtime": None, "data": None}


def detect_recurring_expenses(force=False):
    """Cached entry point. Recomputes only when the master DB file changes (or force=True)."""
    if not os.path.exists(MASTER_DB_PATH):
        return []
    try:
        mtime = os.path.getmtime(MASTER_DB_PATH)
    except OSError:
        mtime = None
    if not force and _recurring_cache["data"] is not None and _recurring_cache["mtime"] == mtime:
        return _recurring_cache["data"]
    data = _compute_recurring_expenses()
    _recurring_cache["mtime"] = mtime
    _recurring_cache["data"] = data
    return data


def _compute_recurring_expenses():
    """Scans the master database for repeating expenses, income deposits, and savings transfers."""
    from collections import Counter
    if not os.path.exists(MASTER_DB_PATH):
        return []

    df = pd.read_csv(MASTER_DB_PATH)
    if df.empty:
        return []

    # Ensure Date is datetime type
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
    df = df.dropna(subset=['Date', 'Amount'])
    df = df.sort_values(by='Date')

    # Load categories for type classification
    cats = load_categories()
    income_cats = cats.get('Income', [])
    savings_cats = cats.get('Savings', [])
    transfer_cats = cats.get('Transfer', ['Transfer'])

    # Normalize merchant name
    df['Merchant'] = df['Description'].apply(extract_core_merchant)

    # Split by Is_Outflow to prevent mixing inflows and outflows!
    df['Is_Outflow'] = df['Amount'] < 0
    grouped = df.groupby(['Merchant', 'Person', 'Is_Outflow'])

    recurring_items = []
    latest_overall_date = df['Date'].max()
    if pd.isna(latest_overall_date):
        latest_overall_date = datetime.now()

    for (merchant, person, is_outflow), group in grouped:
        count = len(group)
        if count < 2:
            continue

        amounts = group['Amount'].tolist()
        dates = group['Date'].tolist()

        # Calculate days difference between consecutive dates.
        # Same-day (0-day) gaps come from duplicate charges or overlapping statement
        # imports, not a real billing cycle — counting them drags the average down and
        # misclassifies e.g. a monthly $59 service as "Bi-weekly" (doubling its burden).
        diffs = []
        for i in range(1, len(dates)):
            diff = (dates[i] - dates[i-1]).days
            if diff > 0:
                diffs.append(diff)

        avg_days = sum(diffs) / len(diffs) if diffs else 0
        avg_amount = sum(amounts) / len(amounts)
        last_date = dates[-1]

        # Classify the Flow Type dynamically based on amounts and categories
        first_row_cat = str(group['Category'].iloc[0])
        first_row_desc_lower = str(group['Description'].iloc[0]).lower()

        if not is_outflow:
            # Positive amounts represent Cash Inflow (Income / Inbound transfers)
            if first_row_cat in income_cats or any(k in first_row_desc_lower for k in ['payroll', 'salary', 'wages', 'direct dep', 'direct deposit', 'zelle from', 'zelle payment from']):
                flow_type = "Income Inflow"
            else:
                flow_type = "Other Inflow"
        else:
            # Negative amounts represent Outflow (Expenses, Savings deposits, AutoPay transfers)
            debt_cats = {'Car', 'Car Expenses', 'Debt', 'Loan', 'Auto Loan', 'Mortgage', 'Student Loan'}
            if first_row_cat in savings_cats or any(k in first_row_desc_lower for k in ['schwab', 'wealthfront', 'fidelity', 'brokerage', 'savings', 'invest', 'saving']):
                flow_type = "Savings Transfer"
            elif first_row_cat in transfer_cats or any(k in first_row_desc_lower for k in ['autopay', 'directpay', 'card payment', 'payment', 'chase auto-pmt', 'discover py', 'capital one py']):
                flow_type = "Debt / CC Repayment"
            elif first_row_cat in debt_cats or any(k in first_row_desc_lower for k in ['loan', 'mortgage', 'financ']):
                # Loan / car / mortgage installments are debt servicing, not subscriptions.
                # Without this, a fixed monthly car payment inflates the Subscription Load.
                flow_type = "Debt / CC Repayment"
            else:
                flow_type = "Expense (Subscription)"

        # Enforce mode-ratio approach for pure subscriptions
        rounded_amounts = [round(abs(a), 2) for a in amounts]
        amount_counts = Counter(rounded_amounts)
        mode_amount, mode_count = amount_counts.most_common(1)[0]
        mode_ratio = mode_count / len(rounded_amounts)

        is_sub = False
        if flow_type == "Expense (Subscription)":
            desc_lower = first_row_desc_lower.lower()
            sub_keywords = [
                'sub', 'netflix', 'spotify', 'prime', 'hulu', 'disney', 'youtube', 
                'membership', 'gym', 'internet', 'utility', 'insurance', 'rent', 'bill', 
                'mobile', 'phone', 'wireless', 'google fi', 'icloud', 'apple.com/bill', 
                'google *services', 'adobe', 'microsoft', 'office 365', 'zoom', 'github', 
                'chatgpt', 'openai', 'canal', 'nyt', 'nytimes', 'patreon'
            ]
            is_discretionary = first_row_cat in ['Dining', 'Groceries', 'Gas', 'Merchandise', 'Travel', 'Uncategorized']
            has_sub_keyword = any(kw in desc_lower or kw in merchant.lower() for kw in sub_keywords)
            
            if is_discretionary and not has_sub_keyword:
                is_sub = False
            else:
                if mode_count >= 3 and mode_ratio >= 0.5:
                    is_sub = True
                elif mode_count >= 2 and mode_ratio >= 0.75:
                    is_sub = True
                elif merchant in ["GOOGLE FI", "AMAZON PRIME", "NETFLIX", "SPOTIFY"] and count >= 2:
                    is_sub = True

        if flow_type == "Expense (Subscription)" and not is_sub:
            continue

        representative_amount = mode_amount if (flow_type == "Expense (Subscription)" and is_sub) else abs(avg_amount)

        # Calculate billing frequency based on intervals
        if 5 <= avg_days <= 10:
            frequency = "Weekly"
            monthly_burden = representative_amount * 4.33
        elif 11 <= avg_days <= 18:
            frequency = "Bi-weekly"
            monthly_burden = representative_amount * 2.16
        elif 25 <= avg_days <= 35:
            frequency = "Monthly"
            monthly_burden = representative_amount
        elif 80 <= avg_days <= 100:
            frequency = "Quarterly"
            monthly_burden = representative_amount / 3.0
        elif 340 <= avg_days <= 385:
            frequency = "Annually"
            monthly_burden = representative_amount / 12.0
        else:
            if count >= 3:
                frequency = "Recurring"
                monthly_burden = representative_amount
            else:
                continue

        # Tag active status
        days_since_last = (latest_overall_date - last_date).days
        grace_period = max(45, avg_days * 1.5)
        is_active = days_since_last <= grace_period

        # Estimate the next expected occurrence from the average interval
        next_due = None
        if avg_days > 0:
            from datetime import timedelta
            next_due = (last_date + timedelta(days=round(avg_days))).strftime('%Y-%m-%d')

        # Extract payment history and typical billing day of month
        group_sorted = group.sort_values(by='Date', ascending=False)
        charges_list = []
        days = []
        for _, r in group_sorted.iterrows():
            charges_list.append({
                "id": str(r['Transaction_ID']) if 'Transaction_ID' in group.columns else "",
                "date": r['Date'].strftime('%Y-%m-%d'),
                "amount": float(r['Amount']),
                "category": str(r['Category']) if 'Category' in group.columns else ""
            })
            days.append(r['Date'].day)
            
        from collections import Counter
        common_day = Counter(days).most_common(1)[0][0] if days else 1

        recurring_items.append({
            "merchant": merchant,
            "person": person,
            "count": count,
            "frequency": frequency,
            "avg_amount": round(representative_amount, 2),
            "monthly_burden": round(monthly_burden, 2),
            "last_date": last_date.strftime('%Y-%m-%d'),
            "next_due": next_due,
            "interval_days": round(avg_days, 1),
            "is_active": bool(is_active),
            "flow_type": flow_type,
            "card": str(group['Account'].iloc[-1]) if 'Account' in group.columns else "Primary Account",
            "charges": charges_list,
            "day_of_month": int(common_day)
        })

    # Sort recurring items: active first, then flow_type order, then monthly burden descending
    flow_priority = {
        "Income Inflow": 1,
        "Savings Transfer": 2,
        "Expense (Subscription)": 3,
        "Debt / CC Repayment": 4,
        "Other Inflow": 5
    }
    recurring_items = sorted(
        recurring_items, 
        key=lambda x: (not x['is_active'], flow_priority.get(x['flow_type'], 9), -x['monthly_burden'])
    )

    if recurring_items:
        os.makedirs(os.path.dirname(RECURRING_DB_PATH), exist_ok=True)
        pd.DataFrame(recurring_items).to_csv(RECURRING_DB_PATH, index=False)

    return recurring_items

if __name__ == "__main__":
    items = detect_recurring_expenses()
    print(f"Detected {len(items)} recurring items.")