param(
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"

function Write-Info($Message) {
  Write-Host "[CarbonFlow] $Message" -ForegroundColor Cyan
}

function Write-Fail($Message) {
  Write-Host "[CarbonFlow] $Message" -ForegroundColor Red
}

$InstallRoot = Join-Path $env:ProgramData "CarbonFlowServer"
$ComposeRoot = Join-Path $InstallRoot "compose"
$WindowsTools = Join-Path $InstallRoot "windows"
$BundleZip = Join-Path $PSScriptRoot "carbonflow-server-payload.zip"
$SourceRoot = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot "docker-compose.yml")) {
  $PSScriptRoot
} else {
  Split-Path -Parent $PSScriptRoot
}
$SourceBase = Split-Path -Parent $SourceRoot
$ComposeFile = Join-Path $ComposeRoot "docker-compose.yml"
$EnvFile = Join-Path $ComposeRoot ".env"
$EnvExample = Join-Path $ComposeRoot ".env.example"

Write-Info "Installing CarbonFlow Server to $InstallRoot"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path $ComposeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $WindowsTools | Out-Null

if (Test-Path -LiteralPath $BundleZip) {
  Write-Info "Expanding bundled server payload..."
  Expand-Archive -LiteralPath $BundleZip -DestinationPath $InstallRoot -Force
} else {
  $ComposeItems = @(
    "README.md",
    ".env.example",
    "docker-compose.yml",
    "docker-compose.ci.yml",
    "control-panel",
    "release-api",
    "litecart",
    "telemetry-api"
  )

  foreach ($Item in $ComposeItems) {
    $Source = Join-Path $SourceRoot $Item
    if (!(Test-Path -LiteralPath $Source)) {
      throw "Missing required package item: $Item"
    }
    Copy-Item -LiteralPath $Source -Destination (Join-Path $ComposeRoot $Item) -Recurse -Force
  }

  foreach ($SupportDir in @("scripts", "config", "workflows")) {
    $Source = Join-Path $SourceBase $SupportDir
    if (Test-Path -LiteralPath $Source) {
      Copy-Item -LiteralPath $Source -Destination (Join-Path $InstallRoot $SupportDir) -Recurse -Force
    }
  }
}

Copy-Item -LiteralPath $MyInvocation.MyCommand.Path -Destination (Join-Path $WindowsTools "install-carbonflow-server.ps1") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "uninstall-carbonflow-server.ps1") -Destination (Join-Path $WindowsTools "uninstall-carbonflow-server.ps1") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "verify-carbonflow-server.ps1") -Destination (Join-Path $WindowsTools "verify-carbonflow-server.ps1") -Force

if (!(Test-Path -LiteralPath $EnvFile)) {
  Copy-Item -LiteralPath $EnvExample -Destination $EnvFile -Force
  Write-Info ".env created from .env.example. Edit secrets before public deployment."
}

$Docker = Get-Command docker -ErrorAction SilentlyContinue
if (!$Docker) {
  Write-Fail "Docker Desktop is not installed or is not in PATH."
  Write-Host "AR: ثبّت Docker Desktop ثم شغّل المثبّت مرة أخرى."
  Write-Host "EN: Install Docker Desktop, then run this installer again."
  exit 20
}

Push-Location $ComposeRoot
try {
  docker compose version | Out-Host
  docker compose -f $ComposeFile --env-file $EnvFile config --quiet
  Write-Info "Docker Compose configuration is valid."

  if ($SkipStart) {
    Write-Info "SkipStart enabled. Files installed without starting containers."
    exit 0
  }

  Write-Info "Starting CarbonFlow Server stack..."
  docker compose -f $ComposeFile --env-file $EnvFile up -d
  Write-Info "Installation completed. Control panel URL: http://localhost:8088"
}
finally {
  Pop-Location
}
