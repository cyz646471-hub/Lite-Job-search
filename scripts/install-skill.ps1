param(
  [string]$CodexHome = $env:CODEX_HOME,
  [switch]$Force
)

if (-not $CodexHome) {
  $CodexHome = Join-Path $HOME '.codex'
}
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$source = Join-Path $projectRoot '.agents\skills\lite-job-search'
$destination = Join-Path $CodexHome 'skills\lite-job-search'

if (Test-Path -LiteralPath $destination) {
  if (-not $Force) {
    throw "Skill already exists at $destination. Re-run with -Force to replace it."
  }
  $resolvedHome = [System.IO.Path]::GetFullPath($CodexHome)
  $resolvedDestination = [System.IO.Path]::GetFullPath($destination)
  if (-not $resolvedDestination.StartsWith($resolvedHome, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a destination outside CODEX_HOME: $resolvedDestination"
  }
  Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
}

New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Recurse
Write-Output "Installed lite-job-search skill at $destination"

