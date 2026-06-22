"""Regression tests for core/recurring.py classification logic.

Dependency-free (no pytest). Run from the project root with the venv interpreter:

    .venv\\Scripts\\python.exe tests\\test_recurring.py

Covers the three fixes made to subscription/recurring detection:
  1. extract_core_merchant canonicalises ClassPass (statement suffix varies).
  2. Fixed monthly loan/car payments are classified as debt, not subscriptions.
  3. Same-day duplicate charges don't drag the billing interval into "Bi-weekly".
"""
import os
import sys
import tempfile

import pandas as pd

# Make the project root importable so `core.recurring` resolves regardless of cwd.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, os.path.join(PROJECT_ROOT, "core"))

from core import recurring


def _run_detector(rows):
    """Write synthetic rows to a temp master CSV, point the module at it, and detect."""
    cols = ["Transaction_ID", "Date", "Description", "Amount", "Category", "Person", "Account"]
    df = pd.DataFrame(rows, columns=cols)

    tmp_dir = tempfile.mkdtemp(prefix="budgetbot_test_")
    master = os.path.join(tmp_dir, "master.csv")
    df.to_csv(master, index=False)

    orig_master, orig_recurring = recurring.MASTER_DB_PATH, recurring.RECURRING_DB_PATH
    recurring.MASTER_DB_PATH = master
    recurring.RECURRING_DB_PATH = os.path.join(tmp_dir, "recurring.csv")
    try:
        return recurring.detect_recurring_expenses(force=True)
    finally:
        recurring.MASTER_DB_PATH, recurring.RECURRING_DB_PATH = orig_master, orig_recurring


def _monthly(desc, amount, category, person, day=15, months=("2025-09", "2025-10", "2025-11",
                                                              "2025-12", "2026-01", "2026-02")):
    return [
        [f"{desc}-{m}", f"{m}-{day:02d}", desc, amount, category, person, "Test Card"]
        for m in months
    ]


def test_extract_core_merchant_canonicalises_classpass():
    for raw in ["CLASSPASS MONTHLY", "CLASSPASS MONTHLY MISSOULA", "CLASSPASS*MONTHLY"]:
        got = recurring.extract_core_merchant(raw)
        assert got == "CLASSPASS", f"{raw!r} -> {got!r}, expected 'CLASSPASS'"


def test_car_loan_is_debt_not_subscription():
    items = _run_detector(_monthly("TOYOTA ACH RTL", -700.0, "Car", "tester"))
    toyota = [x for x in items if x["merchant"].startswith("TOYOTA")]
    assert toyota, "Toyota payment not detected as recurring at all"
    assert toyota[0]["flow_type"] == "Debt / CC Repayment", \
        f"car loan classified as {toyota[0]['flow_type']!r}, expected debt"


def test_same_day_duplicates_stay_monthly():
    # A monthly $59 subscription that also has a duplicate charge on the same day each month.
    rows = []
    for m in ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]:
        rows.append([f"CP-{m}-a", f"{m}-16", "CLASSPASS MONTHLY", -59.0, "Subscription", "tester", "Card"])
        rows.append([f"CP-{m}-b", f"{m}-16", "CLASSPASS MONTHLY MISSOULA", -59.0, "Subscription", "tester", "Card"])
    items = _run_detector(rows)
    cp = [x for x in items if x["merchant"] == "CLASSPASS"]
    assert cp, "ClassPass not detected"
    assert cp[0]["frequency"] == "Monthly", \
        f"ClassPass classified as {cp[0]['frequency']!r}, expected Monthly (same-day dupes ignored)"
    assert cp[0]["flow_type"] == "Expense (Subscription)"


def test_real_subscription_still_detected():
    items = _run_detector(_monthly("NETFLIX.COM", -15.49, "Subscription", "tester"))
    nf = [x for x in items if "NETFLIX" in x["merchant"]]
    assert nf, "Netflix subscription was lost"
    assert nf[0]["flow_type"] == "Expense (Subscription)"
    assert nf[0]["frequency"] == "Monthly"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"  FAIL  {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
