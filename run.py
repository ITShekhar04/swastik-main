"""
SWASTIK Launcher
Starts the Uvicorn server on http://127.0.0.1:8000 and opens the browser.
"""
import uvicorn
import webbrowser
import threading
import time
import os
import sys

def open_browser():
    time.sleep(1.2)
    url = "http://127.0.0.1:8000"
    print(f"\n[*] SWASTIK Mission Control online at: {url}")
    print("[*] Launching defense command interface in default browser...")
    webbrowser.open(url)

if __name__ == "__main__":
    # Ensure current working directory is in sys.path
    curr_dir = os.path.dirname(os.path.abspath(__file__))
    if curr_dir not in sys.path:
        sys.path.insert(0, curr_dir)

    print("=" * 70)
    print("  SWASTIK: AI ADAPTIVE SMART SCAN & SPECTRUM INTELLIGENCE")
    print("  SIH 2025-2026 // Smart Scan Strategy for Electronic Warfare")
    print("  Safe Synthetic Simulation & Research Prototype")
    print("=" * 70)
    
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, log_level="info")
