# Investigation Report — Agent Auto-Update Mechanism

## Summary Answer

The codebase has **no agent auto-update mechanism**. When you release new versions of `heartbeat-agent.sh`, `health-monitor-agent.sh`, `heartbeat-agent.ps1`, `health-monitor-agent.ps1`, or `supabase_agent.py`, the only way to get them onto a machine is to re-run the installer on that machine manually. The user wants a system where: (a) the server holds the canonical, versioned scripts; (b) installed agents check their local script version against the server on each heartbeat or health run; and (c) when a newer version is available, the agent downloads and replaces itself, then re-executes — all triggered by a single "push" button in the dashboard.

This is a medium-complexity but well-scoped feature. The existing command-dispatch infrastructure (`EndpointCommand` model → `GET /api/agent/commands/<hostname>/`) already delivers arbitrary commands to agents. The simplest and most compatible approach extends that infrastructure with a new command type `update_scripts`, adds a server-side script-serving endpoint, and adds a self-update section to each installed agent script. No third-party tools are needed.

---

## Evidence

### 1. What agents are installed and how they run

Agents land at:
- **Linux**: `/opt/EndpointAgent/heartbeat-agent.sh`, `/opt/EndpointAgent/health-monitor-agent.sh`, `/opt/EndpointAgent/supabase_agent.py`
- **Windows**: `C:\Program Files\EndpointAgent\heartbeat-agent.ps1`, `health-monitor-agent.ps1`, `supabase_agent.py`
- **macOS**: `/Library/Application Support/EndpointAgent/` (same layout as Linux)

They are written by the installer's `here-doc` blocks at install time and never touched again:
- `Backend/Installer/Linux/install_endpoint_agent.sh` — lines 550–730 write the heartbeat agent and health agent via `cat > "$AGENT_SCRIPT" <<'HEARTBEAT_AGENT_EOF'` and `cat > "$HEALTH_AGENT_SCRIPT" <<'HEALTH_AGENT_EOF'`.
- `Backend/Installer/Windows/install_endpoint_agent.ps1` — lines 550–1040 write the agents via `$HeartbeatAgentContent = @'...'@` and `Set-Content -Path $AgentScript`.

The agents carry a hardcoded `$AgentVersion = "1.3"` / `AGENT_VERSION="1.2"` constant that is sent with every heartbeat but never compared against anything on the server (`Backend/dashboard/views.py` heartbeat handler stores it in `EndpointStatus.agent_version` but never acts on it).

### 2. Version is already reported but ignored

`Backend/dashboard/models.py` — `EndpointStatus.agent_version` is a `CharField(max_length=20, blank=True)`. It is populated from every heartbeat (`views.py` line ~148: `defaults["agent_version"] = data["agent_version"]`). The dashboard serializer returns it in `GET /api/endpoints/status/` responses. The frontend type `EndpointStatus.agent_version` is typed and rendered in `LiveStatusPage.tsx`.

There is no server-side "current version" record to compare against. The comparison is never made.

### 3. Command dispatch infrastructure already exists

`EndpointCommand` model (`Backend/dashboard/models.py`) — has `COMMAND_CHOICES = [('shutdown', 'Shutdown'), ('restart', 'Restart')]`. The Django view `agent_fetch_commands` (`views.py` lines ~315–375) delivers pending commands to agents. The Windows and Linux agents both have a command-polling section that calls `supabase_agent.py poll_commands --mac ...` and executes `restart` or `shutdown` based on the returned command type. All three layers (DB model, server view, agent execution loop) are in place and working. Adding `update_scripts` as a new command type requires only: adding it to `COMMAND_CHOICES`, adding a migration, and adding an execution branch in each agent.

### 4. The agent scripts are static files inside the installer

The installer embeds the agent scripts as literal strings (`here-doc` / PowerShell `@'...'@`). There is no script-serving endpoint on the backend. If you want the server to distribute scripts on demand, you need a new Django view that serves each script's content (or a static URL pointing to a file on disk that the server updates on deploy).

The simplest approach: store the canonical scripts in `Backend/dashboard/static/agents/` (a directory the Django `collectstatic` / nginx already serves), name them with the version (`heartbeat-agent-1.4.sh`, etc.), and expose a JSON manifest endpoint (`/api/agent/manifest/`) that returns the current version and download URLs for each OS. Agents compare their embedded version string to the manifest, download the new scripts if behind, replace themselves, and re-exec.

### 5. How the "push one button" part works

The existing `PowerManagementPage.tsx` calls `apiClient.powerAction(hostname, action)` which hits `POST /api/endpoints/<hostname>/power/<action>/`. This creates an `EndpointCommand` row in the DB. The agent picks it up on the next heartbeat/health cycle (every 20 seconds on Linux, every minute on Windows).

The same mechanism works for `update_scripts`: the UI sends a POST to a new endpoint (or reuses the power-action pattern), the backend creates an `EndpointCommand` with `command='update_scripts'`, the agent polls and handles it. A "Push Update to All" button can iterate over all online endpoints and queue the command for each.

### 6. macOS heartbeat agent gap

The macOS heartbeat (`Backend/heartbeat/macos/heartbeat.sh`) does **not** go through `supabase_agent.py`. It calls `curl` directly to the local Django API. The macOS installer (`Backend/Installer/MAC/install_endpoint_agent.sh`) does write a `supabase_agent.py` to the agent directory, but the installed heartbeat agent (`macos/heartbeat.sh`) ignores it. Any auto-update implementation must account for this difference.

---

## Conclusions

The codebase is well-positioned for this feature. The five components that need to be built or extended are:

1. **Script version manifest endpoint** — A new Django view `GET /api/agent/manifest/` that returns a JSON object with the current version string for each agent type and download URLs. The scripts themselves can be served as static files.

2. **Script files served from the server** — The canonical agent scripts (or their latest text) stored somewhere the Django server can serve on demand. The simplest path: static files at `Backend/dashboard/static/agents/` committed to the repo, served via nginx/Django. When you update a script, bump the version string in the manifest.

3. **`update_scripts` command type** — Add to `EndpointCommand.COMMAND_CHOICES`. Add a migration. Add server-side views to queue it (`POST /api/endpoints/<hostname>/update-scripts/` or fold into the power-action pattern). Add a "Push Update" button in the frontend, either on `PowerManagementPage.tsx` or as a new page.

4. **Self-update logic in each installed agent** — Each agent's main loop adds: (a) fetch manifest from server, (b) compare version, (c) if behind, download new scripts to temp path, replace current scripts, re-exec or let the next timer trigger the new version. This logic runs either on every heartbeat or only when the `update_scripts` command is received.

5. **Re-exec / restart after update** — On Linux, the agent can `exec bash /new/script` or simply exit and let the systemd timer fire the new version. On Windows, the PowerShell agent can terminate and Task Scheduler fires the updated script on the next interval. This avoids needing elevated self-patching.

---

## Recommended Design

**Script manifest** lives at `GET /api/agent/manifest/` (Bearer-authenticated, same `HEARTBEAT_API_KEY`). Returns:
```json
{
  "current_version": "1.4",
  "scripts": {
    "linux":   { "heartbeat": "/static/agents/heartbeat-agent-linux.sh",   "health": "/static/agents/health-monitor-linux.sh",   "supabase": "/static/agents/supabase_agent.py" },
    "windows": { "heartbeat": "/static/agents/heartbeat-agent-windows.ps1", "health": "/static/agents/health-monitor-windows.ps1", "supabase": "/static/agents/supabase_agent.py" },
    "macos":   { "heartbeat": "/static/agents/heartbeat-agent-macos.sh",    "health": "/static/agents/health-monitor-macos.sh",    "supabase": "/static/agents/supabase_agent.py" }
  }
}
```

**Agent self-update trigger**: `update_scripts` command queued by the server, polled by `supabase_agent.py poll_commands`. On receipt, the agent:
1. Downloads scripts to temp files.
2. Verifies they are non-empty.
3. Moves them into place with `mv` / `Move-Item`.
4. Exits (the timer restarts the new version within 20 seconds / 1 minute).

**UI**: A "Push Script Update" button on `PowerManagementPage.tsx` (per-endpoint) and a "Push to All Online" bulk action. Reuses the existing `AlertDialog` pattern already in that page.

**Version tracking**: The manifest version string (e.g. `"1.4"`) is set by updating a constant in `Backend/core/settings.py` or in the manifest view itself. When you commit new agent scripts, bump the version. Each agent logs `Current: 1.3, Available: 1.4 — updating` to stdout/journal.

**Files to create or modify**:
| File | Change |
|------|--------|
| `Backend/dashboard/models.py` | Add `'update_scripts'` to `EndpointCommand.COMMAND_CHOICES` |
| `Backend/dashboard/migrations/00NN_...py` | Migration for new COMMAND_CHOICES value |
| `Backend/dashboard/views.py` | New `update_scripts` power-action view; agent command handler returns `update_scripts` type |
| `Backend/dashboard/urls.py` | Register new URL `api/endpoints/<hostname>/update-scripts/` |
| `Backend/dashboard/static/agents/` | New directory with versioned agent scripts |
| `Backend/dashboard/views.py` (or new module) | `GET /api/agent/manifest/` view |
| `Backend/Installer/Linux/install_endpoint_agent.sh` | Embed version check + self-update logic in both installed agents |
| `Backend/Installer/Windows/install_endpoint_agent.ps1` | Same for Windows agents |
| `Backend/Installer/MAC/install_endpoint_agent.sh` | Same for macOS agents |
| `Backend/heartbeat/linux/heartbeat.sh` | Add version check + self-update section (standalone agent variant) |
| `Backend/heartbeat/windows/heartbeat.ps1` | Same |
| `Backend/heartbeat/macos/heartbeat.sh` | Same |
| `frontend/src/frontend/src/pages/PowerManagementPage.tsx` | Add "Push Update" button per-endpoint + "Push to All" bulk action |
| `frontend/src/frontend/src/lib/api-client.ts` | Add `pushScriptUpdate(hostname)` and `pushScriptUpdateAll()` methods |
