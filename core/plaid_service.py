"""Plaid integration service for Wally.

Handles the full Plaid Link lifecycle so each local profile can connect its own bank
institutions and pull transactions straight into the shared master ledger:

    create_link_token  -> exchange_public_token -> fetch_new_transactions

Access tokens and per-item sync cursors are persisted in data/plaid_items.json. That file
holds live banking credentials in plaintext, so it MUST stay out of version control and off
shared drives (see .gitignore). This is acceptable for a self-hosted, single-machine app;
do not deploy this storage model to a shared/multi-tenant server.

Credentials can be set two ways, in priority order:
    1. The in-app Settings → Bank Connections form, which saves them to
       data/plaid_config.json (see save_config). This is the recommended path —
       the user never has to find or edit a file, and changes apply live.
    2. Environment variables / a .env file in the project root (legacy fallback).

Recognized keys (either source):
    PLAID_CLIENT_ID   - your Plaid client id
    PLAID_SECRET      - your Plaid secret for the chosen environment
    PLAID_ENV         - "production" (default) or "sandbox"
    PLAID_REDIRECT_URI- optional; required for OAuth banks (must be registered in the
                        Plaid dashboard, e.g. http://localhost:5173)
"""

import os
import json
import threading

# --- Storage --------------------------------------------------------------------------
DATA_ROOT = "data"
ITEMS_PATH = os.path.join(DATA_ROOT, "plaid_items.json")
CONFIG_PATH = os.path.join(DATA_ROOT, "plaid_config.json")
_items_lock = threading.RLock()
_config_lock = threading.RLock()

# Keys mirrored between data/plaid_config.json and os.environ.
_CONFIG_ENV_KEYS = ("PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV", "PLAID_REDIRECT_URI")


def _load_config_file():
    """Reads data/plaid_config.json (the UI-saved credentials). Returns {} if absent."""
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"Error loading plaid config: {e}")
        return {}


def _apply_config_to_env(cfg):
    """Pushes non-empty saved-config values into os.environ so the rest of the
    module (which reads os.environ) picks them up — at import and after a save."""
    for k in _CONFIG_ENV_KEYS:
        v = cfg.get(k)
        if v is not None and str(v).strip() != "":
            os.environ[k] = str(v).strip()


def _bootstrap_credentials():
    """Load credentials at import: .env first (legacy), then the UI-saved
    data/plaid_config.json on top so the in-app form always wins."""
    try:
        from dotenv import load_dotenv
        # Load .env from the project root (one level above this core/ file).
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        load_dotenv(os.path.join(project_root, ".env"), override=True)
    except Exception:
        pass
    _apply_config_to_env(_load_config_file())


_bootstrap_credentials()

# Master ledger column order, kept in sync with core/api.py.
LEDGER_COLUMNS = [
    "Transaction_ID", "Date", "Description", "Amount",
    "Category", "Person", "Account", "Dismissed_Categories",
]


def _load_items():
    if not os.path.exists(ITEMS_PATH):
        return []
    try:
        with open(ITEMS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("items", []) if isinstance(data, dict) else []
    except Exception as e:
        print(f"Error loading plaid items: {e}")
        return []


def _save_items(items):
    with _items_lock:
        os.makedirs(DATA_ROOT, exist_ok=True)
        tmp = ITEMS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"items": items}, f, indent=2)
        os.replace(tmp, ITEMS_PATH)


# --- Credential configuration (UI-driven) --------------------------------------------
def is_configured():
    return bool(os.environ.get("PLAID_CLIENT_ID") and os.environ.get("PLAID_SECRET"))


def save_config(client_id, secret, env="production", redirect_uri=""):
    """Persist Plaid credentials entered in the web UI and apply them live.

    Writes data/plaid_config.json and updates os.environ in the running process,
    so Plaid starts working immediately — the user never edits .env or restarts.
    A blank `secret` keeps any previously saved secret (lets the user tweak the
    environment or redirect URI without re-pasting it). Returns the public
    (secret-free) config view.
    """
    client_id = (client_id or "").strip()
    secret = (secret or "").strip()
    env = (env or "production").strip().lower()
    redirect_uri = (redirect_uri or "").strip()
    if env not in ("production", "sandbox"):
        env = "production"

    cfg = _load_config_file()
    cfg["PLAID_CLIENT_ID"] = client_id
    if secret:
        cfg["PLAID_SECRET"] = secret
    cfg["PLAID_ENV"] = env
    cfg["PLAID_REDIRECT_URI"] = redirect_uri

    with _config_lock:
        os.makedirs(DATA_ROOT, exist_ok=True)
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        os.replace(tmp, CONFIG_PATH)

    _apply_config_to_env(cfg)
    # A blanked redirect URI must actually be removed from the live env, since
    # _apply_config_to_env only sets non-empty values.
    if not redirect_uri:
        os.environ.pop("PLAID_REDIRECT_URI", None)
    return get_config_public()


def get_config_public():
    """Non-secret view of the active Plaid config, safe to send to the browser."""
    cid = os.environ.get("PLAID_CLIENT_ID", "")
    if len(cid) > 8:
        masked = f"{cid[:4]}…{cid[-4:]}"
    elif cid:
        masked = "••••"
    else:
        masked = ""
    return {
        "configured": is_configured(),
        "environment": (os.environ.get("PLAID_ENV") or "production").lower(),
        "client_id_masked": masked,
        "has_secret": bool(os.environ.get("PLAID_SECRET")),
        "redirect_uri": os.environ.get("PLAID_REDIRECT_URI", ""),
    }


def _env_host():
    import plaid
    env = (os.environ.get("PLAID_ENV") or "production").strip().lower()
    if env == "sandbox":
        return plaid.Environment.Sandbox
    return plaid.Environment.Production


def _client():
    """Builds a Plaid API client. Raises RuntimeError if credentials are missing."""
    if not is_configured():
        raise RuntimeError(
            "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in your .env file."
        )
    import plaid
    from plaid.api import plaid_api

    configuration = plaid.Configuration(
        host=_env_host(),
        api_key={
            "clientId": os.environ["PLAID_CLIENT_ID"],
            "secret": os.environ["PLAID_SECRET"],
        },
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


def _redirect_uri():
    uri = (os.environ.get("PLAID_REDIRECT_URI") or "").strip()
    return uri or None


# --- Public API -----------------------------------------------------------------------
def create_link_token(person):
    """Creates a short-lived link_token used by Plaid Link in the browser."""
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.products import Products
    from plaid.model.country_code import CountryCode

    client = _client()
    kwargs = dict(
        user=LinkTokenCreateRequestUser(client_user_id=str(person or "default")),
        client_name="Wally",
        products=[Products("transactions")],
        country_codes=[CountryCode("US")],
        language="en",
    )
    redirect = _redirect_uri()
    if redirect:
        kwargs["redirect_uri"] = redirect

    resp = client.link_token_create(LinkTokenCreateRequest(**kwargs))
    return resp["link_token"]


def _fetch_accounts(client, access_token):
    """Returns {account_id: 'Friendly Name ••mask'} for nicer ledger Account labels."""
    from plaid.model.accounts_get_request import AccountsGetRequest
    try:
        resp = client.accounts_get(AccountsGetRequest(access_token=access_token))
        out = {}
        for acct in resp["accounts"]:
            name = acct.get("official_name") or acct.get("name") or "Account"
            mask = acct.get("mask")
            out[acct["account_id"]] = f"{name} ••{mask}" if mask else str(name)
        return out
    except Exception as e:
        print(f"Could not fetch Plaid accounts: {e}")
        return {}


def exchange_public_token(public_token, person, institution_name=None):
    """Exchanges the Link public_token for a long-lived access_token and stores the item."""
    from plaid.model.item_public_token_exchange_request import (
        ItemPublicTokenExchangeRequest,
    )

    client = _client()
    exchange = client.item_public_token_exchange(
        ItemPublicTokenExchangeRequest(public_token=public_token)
    )
    access_token = exchange["access_token"]
    item_id = exchange["item_id"]

    accounts = _fetch_accounts(client, access_token)

    import datetime as _dt
    with _items_lock:
        items = _load_items()
        # Replace any existing record for this item_id (re-link / update mode).
        items = [it for it in items if it.get("item_id") != item_id]
        items.append({
            "item_id": item_id,
            "access_token": access_token,
            "person": str(person or "default"),
            "institution_name": institution_name or "Bank",
            "accounts": accounts,
            "cursor": "",
            "linked_at": _dt.datetime.now().isoformat(timespec="seconds"),
        })
        _save_items(items)

    return {"item_id": item_id, "institution_name": institution_name or "Bank"}


def _map_transaction(txn, item):
    """Converts one Plaid transaction into a master-ledger row dict.

    Plaid amounts are positive when money LEAVES the account; Wally stores expenses as
    negative and inflows as positive, so we negate. The existing categorizer/rules engine
    assigns real categories afterwards, so new rows start Uncategorized.
    """
    accounts = item.get("accounts", {}) or {}
    account_label = accounts.get(
        txn["account_id"], item.get("institution_name", "Bank")
    )
    description = txn.get("merchant_name") or txn.get("name") or "Transaction"
    date_val = txn.get("authorized_date") or txn.get("date")
    return {
        "Transaction_ID": txn["transaction_id"],
        "Date": str(date_val),
        "Description": description,
        "Amount": -float(txn["amount"]),
        "Category": "Uncategorized",
        "Person": item.get("person", "default"),
        "Account": account_label,
        "Dismissed_Categories": "",
    }


def fetch_new_transactions(person=None):
    """Pulls new/updated transactions for connected items via /transactions/sync.

    Returns (added_rows, removed_ids, summary). Advances and persists each item's cursor so
    repeat syncs only fetch the delta. `person` optionally limits the sync to one profile.
    """
    from plaid.model.transactions_sync_request import TransactionsSyncRequest

    client = _client()
    items = _load_items()
    if person and person != "All Users":
        target = [it for it in items if it.get("person") == person]
    else:
        target = items

    added_rows = []
    removed_ids = []
    summary = []

    for item in target:
        access_token = item.get("access_token")
        if not access_token:
            continue
        cursor = item.get("cursor") or ""
        item_added = 0
        item_modified = 0
        item_removed = 0
        try:
            has_more = True
            while has_more:
                req_kwargs = {"access_token": access_token}
                if cursor:
                    req_kwargs["cursor"] = cursor
                resp = client.transactions_sync(TransactionsSyncRequest(**req_kwargs))

                for txn in resp["added"]:
                    added_rows.append(_map_transaction(txn, item))
                    item_added += 1
                for txn in resp["modified"]:
                    added_rows.append(_map_transaction(txn, item))
                    item_modified += 1
                for txn in resp["removed"]:
                    removed_ids.append(txn["transaction_id"])
                    item_removed += 1

                has_more = resp["has_more"]
                cursor = resp["next_cursor"]

            item["cursor"] = cursor
            summary.append({
                "institution": item.get("institution_name", "Bank"),
                "person": item.get("person"),
                "added": item_added,
                "modified": item_modified,
                "removed": item_removed,
            })
        except Exception as e:
            print(f"Plaid sync failed for {item.get('institution_name')}: {e}")
            summary.append({
                "institution": item.get("institution_name", "Bank"),
                "person": item.get("person"),
                "error": str(e),
            })

    # Persist advanced cursors (mutated in place on the loaded list).
    with _items_lock:
        _save_items(items)

    return added_rows, removed_ids, summary


def list_items(person=None):
    """Returns connected institutions without exposing access tokens."""
    items = _load_items()
    out = []
    for it in items:
        if person and person != "All Users" and it.get("person") != person:
            continue
        out.append({
            "item_id": it.get("item_id"),
            "person": it.get("person"),
            "institution_name": it.get("institution_name", "Bank"),
            "accounts": list((it.get("accounts") or {}).values()),
            "linked_at": it.get("linked_at"),
        })
    return out


def remove_item(item_id):
    """Removes a connected item locally and from Plaid (revokes the access token)."""
    from plaid.model.item_remove_request import ItemRemoveRequest

    with _items_lock:
        items = _load_items()
        match = next((it for it in items if it.get("item_id") == item_id), None)
        remaining = [it for it in items if it.get("item_id") != item_id]
        _save_items(remaining)

    if match and match.get("access_token"):
        try:
            client = _client()
            client.item_remove(ItemRemoveRequest(access_token=match["access_token"]))
        except Exception as e:
            print(f"Plaid item_remove call failed (item already removed locally): {e}")

    return match is not None
