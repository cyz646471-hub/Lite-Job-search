param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('CN', 'NA')]
  [string]$Market,

  [Parameter(Mandatory = $true)]
  [string]$Company,

  [string]$OfficialDomain,
  [string]$Manual,
  [string]$Output
)

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')
$cli = Join-Path $projectRoot 'bin\lite-job-search.mjs'
$arguments = @($cli, 'search', '--market', $Market, '--company', $Company, '--json')
if ($OfficialDomain) { $arguments += @('--official-domain', $OfficialDomain) }
if ($Manual) { $arguments += @('--manual', (Resolve-Path $Manual)) }

$result = & node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Output) {
  $target = [System.IO.Path]::GetFullPath($Output)
  [System.IO.File]::WriteAllText($target, ($result -join [Environment]::NewLine))
}
$result

