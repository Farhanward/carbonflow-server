# carbonflow-server - Commercial Readiness

Date: 2026-05-18

## Packaging

One-click Windows installer generated:

`Z:\CARBONPROJECTS\carbonflow-server\release\CarbonFlowServer-OneClick-Setup.exe`

Helper launchers:

- `Z:\CARBONPROJECTS\carbonflow-server\release\Install CarbonFlow Server.cmd`
- `Z:\CARBONPROJECTS\carbonflow-server\release\Verify CarbonFlow Server.cmd`

## How it works

The installer copies the server bundle to `C:\ProgramData\CarbonFlowServer`, creates `.env` from `.env.example`, checks Docker, validates Compose, and starts the stack with Docker Compose.

## Test result

Status: PASS.

The missing service source folders were pulled from the active LAN server at `192.168.100.59`:

- `control-panel`
- `release-api`
- `litecart`
- `telemetry-api`

Support folders were also pulled:

- `scripts`
- `config`
- `workflows`

The real `.env` and deployment keys were intentionally not copied.

Remote live server validation passed:

- Docker installed.
- Docker Compose installed.
- `docker compose config --quiet` passed on `/opt/carbonflow/compose`.
- Live stack containers are running.
- LAN port `8088` is reachable.
- Control panel returns `401`, which confirms the panel is protected by authentication.

Local workstation note: Docker Desktop installation was attempted, but it requires Administrator elevation in the current Windows session. Docker Extension Pack support is installed in VS Code.

E2E validation was completed on the real LAN Docker runtime at `192.168.100.59`:

- Required containers running: PASS.
- MariaDB health checks: PASS.
- Control panel rejects unauthenticated access and accepts valid login: PASS.
- Release API health/latest endpoints: PASS.
- Telemetry API health and authenticated ingest: PASS.
- n8n HTTP response: PASS.

Success after inspection: 100% on the verified LAN runtime.
