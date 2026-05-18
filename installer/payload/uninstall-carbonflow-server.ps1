$ErrorActionPreference = "Stop"

$InstallRoot = Join-Path $env:ProgramData "CarbonFlowServer"
$ComposeRoot = Join-Path $InstallRoot "compose"
$ComposeFile = Join-Path $ComposeRoot "docker-compose.yml"
$EnvFile = Join-Path $ComposeRoot ".env"

if (Test-Path -LiteralPath $ComposeFile) {
  Push-Location $ComposeRoot
  try {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
      docker compose -f $ComposeFile --env-file $EnvFile down
    }
  }
  finally {
    Pop-Location
  }
}

Write-Host "CarbonFlow Server containers stopped. Installed files remain at $InstallRoot."
Write-Host "AR: لم يتم حذف البيانات حتى لا تضيع سجلات أو قواعد بيانات العميل."
Write-Host "EN: Data was preserved intentionally."
