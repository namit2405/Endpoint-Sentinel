"""
Real-time report watcher.

Uses `gio list` to bypass GVFS directory cache and get a live listing
from the SMB server every POLL_INTERVAL seconds. Whenever the set of
.html files changes (add or remove), runs `import_reports --sync`.

Usage:
    python3.11 watch_reports.py

Keep this running alongside the Django dev server.
"""
import os
import sys
import subprocess
import time
import logging
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
MANAGE      = str(PROJECT_DIR / "manage.py")
PYTHON      = sys.executable
POLL_INTERVAL = 5   # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("watcher")


def _resolve_share_uri() -> tuple[str, Path]:
    """
    Returns (smb_base_uri, local_gvfs_path) for the Reports folder.
    Falls back to local Reports/ if share is not mounted.
    """
    uid = os.getuid()
    gvfs = Path(f"/run/user/{uid}/gvfs/smb-share:server=audit-server.local,share=auditreports") / "Reports"
    if gvfs.exists():
        return "smb://audit-server.local/auditreports/Reports", gvfs
    local = PROJECT_DIR / "Reports"
    return None, local


def _gio_list(uri: str) -> set[str]:
    """
    Call `gio list <uri>` to get a FRESH directory listing directly from
    the SMB server, bypassing GVFS cache. Returns set of filenames.
    """
    result = subprocess.run(
        ["gio", "list", uri],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _get_live_html_files(smb_uri: str, subfolders: list[str]) -> set[str]:
    """
    Returns the full set of .html filenames across all subfolders,
    using live gio queries (no GVFS cache).
    Format: "Windows/filename.html"
    """
    files = set()
    for sub in subfolders:
        uri = f"{smb_uri}/{sub}/"
        names = _gio_list(uri)
        for name in names:
            if name.lower().endswith(".html") and not name.startswith("."):
                files.add(f"{sub}/{name}")
    return files


def _get_local_html_files(base: Path, subfolders: list[str]) -> set[str]:
    """Fallback for local paths — plain glob."""
    files = set()
    for sub in subfolders:
        folder = base / sub
        if folder.exists():
            for f in folder.glob("*.html"):
                files.add(f"{sub}/{f.name}")
    return files


def _run_sync():
    log.info("Change detected — running import_reports --sync …")
    result = subprocess.run(
        [PYTHON, MANAGE, "import_reports", "--sync"],
        capture_output=True, text=True, cwd=str(PROJECT_DIR),
    )
    for line in result.stdout.splitlines():
        log.info("  " + line)
    for line in result.stderr.splitlines():
        log.warning("  " + line)


def main():
    smb_uri, local_path = _resolve_share_uri()
    subfolders = ["Windows", "Linux", "macOS"]
    use_gio = smb_uri is not None

    if use_gio:
        log.info(f"Mode     : SMB live polling via gio (bypasses GVFS cache)")
        log.info(f"Share URI: {smb_uri}")
    else:
        log.info(f"Mode     : local filesystem polling")
        log.info(f"Path     : {local_path}")

    log.info(f"Interval : every {POLL_INTERVAL}s")

    # Run initial sync on startup
    _run_sync()

    # Capture the baseline file set AFTER the initial sync
    if use_gio:
        known = _get_live_html_files(smb_uri, subfolders)
    else:
        known = _get_local_html_files(local_path, subfolders)

    log.info(f"Baseline : {len(known)} file(s) — {sorted(known)}")
    log.info("Watching for changes… (Ctrl-C to stop)")

    while True:
        time.sleep(POLL_INTERVAL)
        try:
            if use_gio:
                current = _get_live_html_files(smb_uri, subfolders)
            else:
                current = _get_local_html_files(local_path, subfolders)
        except Exception as e:
            log.warning(f"Poll error: {e}")
            continue

        added   = current - known
        removed = known - current

        if added:
            for f in sorted(added):
                log.info(f"NEW    {f}")
        if removed:
            for f in sorted(removed):
                log.info(f"DELETE {f}")

        if added or removed:
            _run_sync()
            known = current


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Watcher stopped.")
