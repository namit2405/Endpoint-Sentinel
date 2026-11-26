"""
Extracts the embedded agent scripts from the Windows installer
and writes them to Backend/dashboard/static/agents/ so the
auto-update mechanism serves the latest versions.

Run from the Backend directory:
    python sync_static_agents.py
"""
import re
import sys
from pathlib import Path

BASE = Path(__file__).parent
INSTALLER = BASE / "Installer" / "Windows" / "install_endpoint_agent.ps1"
STATIC_DIR = BASE / "dashboard" / "static" / "agents"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

content = INSTALLER.read_text(encoding="utf-8")

# ── Extract heartbeat agent (between first @' ... '@ block after $HeartbeatAgentContent)
hb_match = re.search(
    r'\$HeartbeatAgentContent\s*=\s*@\'(.*?)\'@',
    content, re.DOTALL
)
if hb_match:
    hb_script = hb_match.group(1).strip()
    # Replace __PYTHON_PATH__ with config-driven path
    hb_script = hb_script.replace(
        "$PythonPath = '__PYTHON_PATH__'",
        "# Python path is loaded from config file below"
    )
    # Add version comment at top
    hb_out = f"# Agent Version: 1.4\n# Auto-generated from install_endpoint_agent.ps1 — do not edit directly\n{hb_script}"
    (STATIC_DIR / "heartbeat-agent-windows.ps1").write_text(hb_out, encoding="utf-8")
    print(f"✓ heartbeat-agent-windows.ps1 ({len(hb_script)} chars)")
else:
    print("✗ Could not find heartbeat agent content")

# ── Extract health monitor agent
hm_match = re.search(
    r'\$HealthAgentContent\s*=\s*@\'(.*?)\'@',
    content, re.DOTALL
)
if hm_match:
    hm_script = hm_match.group(1).strip()
    hm_script = hm_script.replace(
        "$PythonPath = '__PYTHON_PATH__'",
        "# Python path is loaded from config file below"
    )
    hm_out = f"# Agent Version: 1.4\n# Auto-generated from install_endpoint_agent.ps1 — do not edit directly\n{hm_script}"
    (STATIC_DIR / "health-monitor-windows.ps1").write_text(hm_out, encoding="utf-8")
    print(f"✓ health-monitor-windows.ps1 ({len(hm_script)} chars)")
else:
    print("✗ Could not find health monitor content")

# ── Copy supabase_agent.py (Windows version)
src = BASE / "Installer" / "Windows" / "supabase_agent.py"
dst = STATIC_DIR / "supabase_agent.py"
dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
print(f"✓ supabase_agent.py ({dst.stat().st_size} bytes)")

# ── Copy Linux heartbeat
src_linux_hb = BASE / "heartbeat" / "linux" / "heartbeat.sh"
if src_linux_hb.exists():
    txt = src_linux_hb.read_text(encoding="utf-8")
    if not txt.startswith("# Agent Version"):
        txt = "# Agent Version: 1.4\n" + txt
    (STATIC_DIR / "heartbeat-agent-linux.sh").write_text(txt, encoding="utf-8")
    print(f"✓ heartbeat-agent-linux.sh ({len(txt)} chars)")

# ── Copy macOS heartbeat
src_macos_hb = BASE / "heartbeat" / "macos" / "heartbeat.sh"
if src_macos_hb.exists():
    txt = src_macos_hb.read_text(encoding="utf-8")
    if not txt.startswith("# Agent Version"):
        txt = "# Agent Version: 1.4\n" + txt
    (STATIC_DIR / "heartbeat-agent-macos.sh").write_text(txt, encoding="utf-8")
    print(f"✓ heartbeat-agent-macos.sh ({len(txt)} chars)")

print()
print("Static agents updated. Files in", STATIC_DIR)
for f in sorted(STATIC_DIR.iterdir()):
    print(f"  {f.name:40s} {f.stat().st_size:>8} bytes")
