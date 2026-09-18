# Endpoint Sentinel macOS Agent

Run the installer from an elevated Terminal on macOS:

```bash
cd "$(dirname "$0")"
sudo bash install_endpoint_agent.sh
```

When Python and Homebrew are missing, the installer automatically installs Homebrew for the logged-in macOS user and then installs Python 3.12. On macOS 10.x, where current Homebrew is unsupported, it automatically uses the official Python.org macOS package instead.

If automatic bootstrapping is blocked by company policy, install the supported runtime manually:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install python@3.12
sudo bash install_endpoint_agent.sh
```


The installer creates:

- `/Library/Application Support/EndpointAgent`
- an isolated Python virtual environment with `psycopg2-binary` and `b2`
- launchd jobs for heartbeat, health monitoring, and the daily audit
- HTML and CSV audit reports under `/Library/Application Support/EndpointAgent/Reports/macOS`

The installer asks for the license key, validates it in Supabase, registers the device by MAC address, and starts the heartbeat and health jobs. macOS WoL support is reported when the platform power settings expose it; otherwise it is recorded as unavailable/disabled rather than guessed.

Useful checks:

```bash
sudo launchctl print system/com.endpointsentinel.heartbeat
sudo launchctl print system/com.endpointsentinel.health
sudo launchctl print system/com.endpointsentinel.audit
sudo tail -f "/Library/Application Support/EndpointAgent/heartbeat.log"
```
