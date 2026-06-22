#!/usr/bin/env python3
"""
Stop Wally.

Shuts down the backend (port 8000) and dashboard (port 5173). Used by the
"Stop Wally" Start Menu shortcut, since the silent launcher has no window to
press Ctrl+C in. Safe to run any time — it just no-ops if nothing is running.
"""

import os
import sys
import subprocess

PORTS = ("8000", "5173")
IS_WINDOWS = os.name == "nt"

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")

_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if IS_WINDOWS else {}


def _kill_windows():
    out = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, **_NO_WINDOW
    ).stdout
    pids = set()
    for line in out.splitlines():
        if "LISTENING" in line.upper() and any(f":{p} " in line for p in PORTS):
            pids.add(line.split()[-1])
    for pid in pids:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", pid],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **_NO_WINDOW,
        )
    return pids


def _kill_unix():
    pids = set()
    for port in PORTS:
        try:
            out = subprocess.run(
                ["lsof", "-ti", f"tcp:{port}"], capture_output=True, text=True
            ).stdout
            pids.update(out.split())
        except FileNotFoundError:
            break
    for pid in pids:
        try:
            os.kill(int(pid), 15)
        except (ProcessLookupError, ValueError):
            pass
    return pids


if __name__ == "__main__":
    killed = _kill_windows() if IS_WINDOWS else _kill_unix()
    print(f"Stopped Wally ({len(killed)} process(es) closed).")
