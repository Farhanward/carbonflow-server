$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ComposeRoot = if (Test-Path -LiteralPath (Join-Path $Root "docker-compose.yml")) {
  $Root
} else {
  Join-Path $Root "compose"
}
$SupportRoot = if ($ComposeRoot -eq $Root) {
  Split-Path -Parent $Root
} else {
  $Root
}
$RequiredFiles = @(
  "README.md",
  ".env.example",
  "docker-compose.yml",
  "docker-compose.ci.yml"
)

$RequiredServiceDirs = @(
  "control-panel",
  "release-api",
  "litecart",
  "telemetry-api"
)

$Missing = New-Object System.Collections.Generic.List[string]
foreach ($File in $RequiredFiles) {
  if (!(Test-Path -LiteralPath (Join-Path $ComposeRoot $File))) {
    $Missing.Add($File)
  }
}

foreach ($Dir in $RequiredServiceDirs) {
  if (!(Test-Path -LiteralPath (Join-Path $ComposeRoot $Dir))) {
    $Missing.Add($Dir)
  }
}

foreach ($Dir in @("scripts", "config", "workflows")) {
  if (!(Test-Path -LiteralPath (Join-Path $SupportRoot $Dir))) {
    $Missing.Add($Dir)
  }
}

$DockerReady = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  try {
    docker compose version | Out-Null
    $DockerReady = $true
  }
  catch {
    $DockerReady = $false
  }
}

[pscustomobject]@{
  Project = "carbonflow-server"
  PackageFilesPresent = ($Missing.Count -eq 0)
  MissingItems = ($Missing -join ", ")
  DockerReady = $DockerReady
  CommercialReadiness = if (($Missing.Count -eq 0) -and $DockerReady) {
    "PASS - ready for deployment smoke test"
  } elseif ($Missing.Count -eq 0) {
    "PASS_WITH_RUNTIME_REQUIREMENT - package is complete; install target needs Docker"
  } else {
    "BLOCKED - missing service sources"
  }
} | Format-List

if ($Missing.Count -gt 0) {
  exit 30
}
