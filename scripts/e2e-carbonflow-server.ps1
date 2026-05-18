param(
  [string]$HostName = "192.168.100.59",
  [string]$UserName = "root",
  [string]$ComposeDir = "/opt/carbonflow/compose"
)

$ErrorActionPreference = "Stop"

if (-not $env:CF_SSH_PASS) {
  throw "Set CF_SSH_PASS in this PowerShell session before running E2E. The password is intentionally not stored in source."
}

$env:CF_SSH_HOST = $HostName
$env:CF_SSH_USER = $UserName
$env:CF_REMOTE_COMPOSE_DIR = $ComposeDir

python "$PSScriptRoot\e2e-carbonflow-server.py"
