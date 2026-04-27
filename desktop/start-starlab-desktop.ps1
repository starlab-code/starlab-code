param(
  [string]$AppUrl = "http://localhost:5173"
)

$ErrorActionPreference = "Stop"
$env:STARLAB_DESKTOP_URL = $AppUrl

Push-Location $PSScriptRoot
try {
  npm run dev
}
finally {
  Pop-Location
}
