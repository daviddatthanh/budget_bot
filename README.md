# Budget Bot — Personal Finance Command Center

A self-hosted budgeting dashboard. It ingests your bank/credit-card CSV exports
(or connects live accounts via Plaid), auto-categorizes transactions with a
trained model, detects recurring expenses, and visualizes your spending and
wealth trajectory.

**Everything runs locally on your own machine.** Your financial data never leaves
your computer — there's no shared server and no account to sign up for. Each
person who uses this runs their own private copy.

<!--
  Add a screenshot to make this page shine:
  1. Run the app, then take a screenshot of the dashboard.
  2. IMPORTANT: use sample/blurred numbers, not your real finances.
  3. Save it as docs/screenshot.png and uncomment the line below.
-->
<!-- ![Budget Bot dashboard](docs/screenshot.png) -->

---

## Quick start

**Prerequisites** (install once):

- **Python 3.11+** — https://www.python.org/downloads/
  (on Windows, tick *"Add Python to PATH"* in the installer)
- **Node.js 18+** — https://nodejs.org/

**Get the code and run it:**

```bash
git clone https://github.com/daviddatthanh/budget_bot.git
cd budget_bot
python start.py
```

That's it. The first run automatically creates a Python virtual environment,
installs all dependencies, starts both servers, and opens the dashboard in your
browser. Press **Ctrl+C** in the terminal to stop everything.

> **Prefer not to use a terminal?**
> - **Windows:** double-click **`start.bat`**
> - **macOS / Linux:** run **`./start.sh`**

Once it's running, open **http://localhost:5173** (it opens on its own the first
time).

---

## Adding your data

**Option A — CSV upload (no setup):** Export transactions from your bank as CSV
and upload them through the dashboard. The app cleans and categorizes them
automatically.

**Option B — Plaid live sync (optional):** Create a free Plaid account at
https://dashboard.plaid.com, copy `.env.example` to `.env`, and paste in your
keys. Then link accounts from the dashboard. Plaid's free tier covers personal
use.

> The categorizer learns from your own transaction history as you confirm
> categories — it starts in "observation mode" and gets more accurate the more
> you use it.

---

## What's in the box

| Part        | Tech                         | Port   |
| ----------- | ---------------------------- | ------ |
| Backend API | FastAPI (`core/api.py`)      | `8000` |
| Dashboard   | React + Vite (`frontend/`)   | `5173` |
| Launcher    | `start.py`                   | —      |
| Pipeline    | `main.py` (clean/categorize) | —      |

---

## Privacy note

This repo intentionally ships **without any financial data**. Your transactions,
Plaid tokens, bank exports, and API keys live in `data/`, `.env`, and
`mcp_config.json` — all of which are git-ignored and never committed. Keep it
that way: don't force-add anything under `data/`.

## License

[MIT](LICENSE) — free to use, modify, and share.
