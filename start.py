#!/usr/bin/env python3
"""
Wally launcher.

One command to start everything:

    python start.py

It checks your setup, installs anything missing the first time, starts the
backend (FastAPI) and the dashboard (Vite), opens your browser, and shuts both
down cleanly when you press Ctrl+C. Works on Windows, macOS, and Linux.
"""

import os
import sys
import time
import shutil
import signal
import subprocess
import webbrowser
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
IS_WINDOWS = os.name == "nt"

BACKEND_URL = "http://127.0.0.1:8000/docs"
DASHBOARD_URL = "http://localhost:5173"

# When launched with pythonw.exe (the silent Start Menu shortcut) there is no
# console, so sys.stdout/err are None and print() would crash. Route them to the
# void so the exact same code runs whether the window is visible or hidden.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")


def _run(cmd, **kw):
    """subprocess.run that never flashes a console window on Windows."""
    if IS_WINDOWS:
        kw.setdefault("creationflags", subprocess.CREATE_NO_WINDOW)
    return subprocess.run(cmd, check=True, **kw)


# --- pretty output -----------------------------------------------------------

def banner(line):
    bar = "=" * 52
    print(f"\n{bar}\n  {line}\n{bar}")


def step(msg):
    print(f"  -> {msg}")


def fail(msg):
    print(f"\n[X] {msg}\n")
    sys.exit(1)


# --- environment checks ------------------------------------------------------

def venv_python():
    """Path to the project's virtualenv Python, creating the venv if needed."""
    py = ROOT / ".venv" / ("Scripts" if IS_WINDOWS else "bin") / (
        "python.exe" if IS_WINDOWS else "python"
    )
    if py.exists():
        return py

    step("First run: creating the Python virtual environment (.venv)...")
    _run([sys.executable, "-m", "venv", str(ROOT / ".venv")])
    step("Installing Python dependencies (this can take a minute)...")
    _run([str(py), "-m", "pip", "install", "-q", "--upgrade", "pip"])
    _run([str(py), "-m", "pip", "install", "-q", "-r", str(ROOT / "requirements.txt")])
    return py


def ensure_node():
    if shutil.which("npm") is None:
        fail(
            "Node.js / npm was not found.\n"
            "    Install it from https://nodejs.org/ and run this again."
        )
    if not (FRONTEND / "node_modules").exists():
        step("First run: installing frontend packages (this can take a minute)...")
        _run("npm install", cwd=FRONTEND, shell=True)


# --- process management ------------------------------------------------------

def spawn(cmd, cwd):
    """Start a child process in its own group so we can stop its whole tree."""
    if IS_WINDOWS:
        return subprocess.Popen(
            cmd, cwd=cwd, shell=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            | subprocess.CREATE_NO_WINDOW,
        )
    return subprocess.Popen(cmd, cwd=cwd, shell=True, start_new_session=True)


def stop(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        proc.terminate()


def wait_for_backend(timeout=40):
    """Poll the backend until it answers, so we open the browser at the right time."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(BACKEND_URL, timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


# --- main --------------------------------------------------------------------

def main():
    os.chdir(ROOT)

    # Already running? Just open the dashboard and exit. This keeps the silent
    # Start Menu launcher from stacking duplicate servers on repeat clicks.
    if wait_for_backend(timeout=1):
        webbrowser.open(DASHBOARD_URL)
        return

    banner("Wally — starting up")

    step("Checking Python environment...")
    py = venv_python()
    step("Checking Node.js / frontend packages...")
    ensure_node()

    backend = frontend = None
    try:
        step("Starting backend API on http://127.0.0.1:8000 ...")
        backend = spawn(
            f'"{py}" -m uvicorn core.api:app --host 127.0.0.1 --port 8000',
            cwd=ROOT,
        )

        if wait_for_backend():
            step("Backend is ready.")
        else:
            step("Backend is taking a while — continuing anyway.")

        step("Starting dashboard on http://localhost:5173 ...")
        frontend = spawn("npm run dev", cwd=FRONTEND)

        banner("Wally is running")
        print(f"  Dashboard:  {DASHBOARD_URL}   (opens automatically)")
        print(f"  API:        http://127.0.0.1:8000")
        print("\n  Press Ctrl+C in this window to stop everything.\n")

        # Keep running until the user interrupts or a server dies.
        while True:
            if backend.poll() is not None:
                fail("The backend stopped unexpectedly. Scroll up for the error.")
            if frontend.poll() is not None:
                fail("The dashboard stopped unexpectedly. Scroll up for the error.")
            time.sleep(1)

    except KeyboardInterrupt:
        banner("Shutting down Wally")
    finally:
        stop(frontend)
        stop(backend)
        step("Stopped. Bye!")


if __name__ == "__main__":
    main()
