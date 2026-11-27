# Two-Section Redesign + Friendly Process Names — Report

## Changes made

### 1. types.ts
- Added display_name?: string to ProcessInfo interface.

### 2. EndpointDetailPage.tsx
**Running Processes & Services section**
- Updated search filter to also match against display_name.
- Process Name column now shows display_name (e.g. "Google Chrome") as the primary label in normal text, with the raw process name (e.g. chrome) in small monospace grey below it. When display_name equals the process name or is absent, only the name is shown.

**Installed Applications section** — no structural changes; already shows full registry names.

### 3. install_endpoint_agent.ps1 (\)
- Replaced old process block comment ("Collect user-facing applications") with "Collect all running processes — UI handles the app/service split".
- Each process entry now includes display_name: uses \.Description first, then \.MainWindowTitle, then falls back to \.ProcessName.
- Sends top 100 by CPU descending, all processes, process_count = total.

### 4. static/agents/health-monitor-windows.ps1
- Regenerated via python sync_static_agents.py from the updated installer.

## Verification
- 
px tsc --noEmit — EXIT 0, no type errors.
- python manage.py check — no issues (0 silenced).
- python sync_static_agents.py — all 5 agent files regenerated successfully.
