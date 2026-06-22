<p align="center">
  <img src="icon/wally-app.png" width="128" alt="Wally logo" />
</p>

<h1 align="center">Wally</h1>

<p align="center">
  <b>Your personal finance command center.</b><br/>
  A private budgeting dashboard that runs entirely on your own computer.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-0ea5e9.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/Python-3.11+-0ea5e9?logo=python&logoColor=white" alt="Python 3.11+" />
  <img src="https://img.shields.io/badge/Node-18+-0ea5e9?logo=nodedotjs&logoColor=white" alt="Node 18+" />
  <img src="https://img.shields.io/badge/Runs-100%25%20local-0ea5e9" alt="Runs 100% local" />
  <img src="https://img.shields.io/badge/Your%20data-never%20leaves-0ea5e9" alt="Your data never leaves" />
</p>

<!--
  Make this page shine: add a dashboard screenshot.
  1. Run Wally, then screenshot the dashboard.
  2. IMPORTANT: use sample/blurred numbers, not your real finances.
  3. Save it as docs/screenshot.png and uncomment the line below.
-->
<!--
<p align="center">
  <img src="docs/screenshot.png" width="820" alt="Wally dashboard" />
</p>
-->

---

## ✨ What Wally does

- 🏦 **Import your money** — drop in bank/credit-card CSV exports, or connect live accounts through Plaid.
- 🧠 **Auto-categorizes everything** — a model trained on your own history sorts each transaction, and gets smarter as you confirm.
- 🔁 **Finds your recurring spend** — surfaces subscriptions, autopays, and salary so nothing hides.
- 📈 **Shows the big picture** — cashflow history, spending by category & card, top destinations, and a wealth trajectory.
- 🔒 **Stays 100% private** — no cloud, no login, no account. Everything lives on your machine.

> Each person who uses Wally runs their own private copy. Your numbers are yours alone.

---

## 🚀 Get started

### 1. Install the basics (once)

| Tool | Link | Note |
| ---- | ---- | ---- |
| **Python 3.11+** | [python.org/downloads](https://www.python.org/downloads/) | On Windows, tick **“Add Python to PATH”** in the installer |
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) | — |

### 2. Download Wally

```bash
git clone https://github.com/daviddatthanh/budget_bot.git
cd budget_bot
```

### 3. Launch it

```bash
python start.py
```

The **first run** sets everything up automatically — creates the Python
environment, installs all dependencies, starts both servers, and opens the
dashboard at **http://localhost:5173**. Press **Ctrl+C** to stop.

**Prefer not to touch a terminal?**

| Platform | How |
| -------- | --- |
| 🪟 **Windows** | Double-click **`start.bat`** |
| 🍎 **macOS / Linux** | Run **`./start.sh`** |

### ⭐ Launch it like a real app (Windows)

Double-click **`Add Wally to Start Menu.bat`** once. From then on, just press the
**Windows key**, type **“Wally”**, and hit **Enter** — it launches with the Wally
icon, no terminal or folder-digging required.

---

## 💸 Add your transactions

**Option A — CSV upload** (nothing to configure): export transactions from your
bank as CSV and upload them in the dashboard. Wally cleans and categorizes them
for you.

**Option B — Plaid live sync** (optional): create a free
[Plaid](https://dashboard.plaid.com) account, copy `.env.example` to `.env`,
paste in your keys, and link accounts right from the dashboard.

> The categorizer starts in “observation mode” and grows more accurate every
> time you confirm a category.

---

## 🛠️ Under the hood

| Part | Tech | Port |
| ---- | ---- | ---- |
| Dashboard | React + Vite | `5173` |
| Backend API | FastAPI | `8000` |
| Launcher | `start.py` | — |
| Brain | scikit-learn categorizer + recurring-expense detection | — |

---

## 🔒 Privacy

Wally ships **without any financial data**. Your transactions, Plaid tokens, bank
exports, and API keys live only in `data/`, `.env`, and `mcp_config.json` — all
git-ignored and never uploaded. Keep it that way: never force-add anything under
`data/`.

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and share.

<p align="center"><sub>Built with ☕ and a healthy fear of overspending.</sub></p>
