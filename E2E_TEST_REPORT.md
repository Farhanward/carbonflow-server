# carbonflow-server E2E Test Report

Date: 2026-05-18
Target server: `192.168.100.59`
Remote compose dir: `/opt/carbonflow/compose`

## Local Docker / VS Code

Docker Extension Pack support is installed in VS Code:

- `ms-azuretools.vscode-docker`
- `ms-azuretools.vscode-containers`
- `ms-vscode-remote.remote-containers`

Docker Desktop installation on this workstation was attempted with `winget`, but the installer required Administrator elevation. This workstation session is not running as Administrator, so the local Docker engine could not be installed here.

## E2E Environment

The E2E test was executed against the active LAN server Docker engine, which is the real deployment runtime.

E2E command:

```powershell
$env:CF_SSH_PASS = "<temporary password>"
.\scripts\e2e-carbonflow-server.ps1
```

The password is not stored in source.

## E2E Result

Status: PASS.

Checks completed:

- Docker CLI available.
- Docker Compose available.
- `docker compose config --quiet` passed.
- Required containers are running.
- MariaDB containers are healthy.
- Control panel rejects unauthenticated access with `401`.
- Control panel accepts valid authentication.
- Release API health endpoint works.
- Release API latest endpoint works.
- Telemetry API health endpoint works.
- Telemetry API accepts authenticated smoke log.
- n8n responds with HTTP `200`.

## Containers Verified

- `carbonflow-control-panel`
- `carbonflow-release-api`
- `carbonflow-telemetry-api`
- `carbonflow-litecart`
- `carbonflow-litecart-db`
- `carbonflow-n8n`
- `carbonflow-npm`
- `carbonflow-npm-db`
- `carbonflow-cloudflared`
- `carbonflow-crowdsec`
- `carbonflow-ollama`
- `carbonflow-cloakbrowser`

## Commercial Status

`carbonflow-server` passes E2E on the real LAN deployment server. The one-click installer package is complete and the application works correctly in the verified Docker runtime.

