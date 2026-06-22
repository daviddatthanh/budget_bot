# Budget Bot — Personal Finance Command Center

A self-hosted budgeting dashboard. It ingests your bank/credit-card CSV exports
(or connects live accounts via Plaid), auto-categorizes transactions with a
trained model, detects recurring expenses, and visualizes your spending and
wealth trajectory.

**Everything runs locally on your own machine.** Your financial data never leaves
your computer — there's no shared server and no account to sign up for. Each
person who uses this runs their own private copy.

---

## What's in the box

- **Backend** — FastAPI (`core/api.py`), serves the API on port `8000`.
- **Frontend** — React + Vite dashboard, runs on port `5173`.
- **Pipeline** — `main.py` cleans, categorizes, and deduplicates uploaded CSVs.

---

## Prerequisites

- **Python 3.11+** — https://www.python.org/downloads/
- **Node.js 18+** — https://nodejs.org/

## Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd budget_bot

# 2. Python backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt

# 3. Frontend
cd frontend
npm install
cd ..

# 4. (Optional) Plaid for live bank sync — see below
cp .env.example .env   # then paste your own Plaid keys
```

## Running it

Start the backend and frontend in two terminals:

```bash
# Terminal 1 — backend
.venv\Scripts\python.exe -m uvicorn core.api:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — frontend
cd frontend
npm run dev
```

Then open **http://localhost:5173**.

On Windows you can also just double-click `run_budget_bot.bat`, which launches
both for you.

## Adding your data

**Option A — CSV upload (no setup):** Export transactions from your bank as CSV
and upload them through the dashboard. The app cleans and categorizes them
automatically.

**Option B — Plaid live sync (optional):** Create a free Plaid account at
https://dashboard.plaid.com, copy your keys into `.env` (use `.env.example` as a
template), and link accounts from the dashboard. Plaid's free tier covers
personal use.

> The categorizer learns from your own transaction history as you confirm
> categories — it starts general and gets more accurate the more you use it.

## Privacy note

This repo intentionally ships **without any financial data**. Your transactions,
Plaid tokens, and bank exports stay in `data/` and `.env`, which are git-ignored
and never committed. Keep it that way — don't force-add anything under `data/`.
