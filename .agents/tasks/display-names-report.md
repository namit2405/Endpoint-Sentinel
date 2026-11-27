# Display Names Report

## Status: Complete

All three changes were already present in the codebase from a prior step. This step verified correctness, re-synced static agents, confirmed zero TypeScript errors, and committed.

## What is in place

### 1. Agent (health-monitor-windows.ps1)
Inside the `$topProcesses` ForEach-Object block, each process payload includes `display_name`:
```powershell
$dispName = $_.ProcessName
try {
    if ($_.Description -and $_.Description -ne '') { $dispName = $_.Description }
    elseif ($_.MainWindowTitle -ne '') { $dispName = $_.MainWindowTitle }
} catch {}
@{ name=$_.ProcessName; display_name=$dispName; pid=$_.Id; cpu_percent=$cpuPct; memory_mb=[math]::Round($_.WorkingSet64/1MB,1) }
```

### 2. types.ts
```typescript
export interface ProcessInfo {
  name: string;
  display_name?: string;
  pid: number;
  cpu_percent: number;
  memory_mb: number;
}
```

### 3. EndpointDetailPage.tsx
- Search filters on both `name` and `display_name`.
- Table cell shows the friendly name (e.g. "Google Chrome") as primary text, and the raw process name (e.g. "chrome") as small grey mono text below — only when they differ.

## Verification
- `python sync_static_agents.py` — ✓ health-monitor-windows.ps1 synced (14874 bytes)
- `pnpm run typecheck` — ✓ 0 errors
- Committed: `256abfb` feat: show friendly display names for running processes
- Pushed: main → origin/main
