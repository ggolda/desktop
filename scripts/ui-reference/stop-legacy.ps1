# Gracefully closes the legacy-ref app (only processes whose path is under legacy-ref), then waits for obs64/crashpad.
$ref = 'legacy-ref'
function Get-Ours { Get-Process | ? { $_.Path -and $_.Path -like "*$ref*" -or ($_.Name -match 'obs64|crash-handler|crashpad' -and $_.Path -like "*$ref*") } }
$p = Get-Ours | ? { $_.Name -eq 'electron' -and $_.MainWindowHandle -ne 0 } | select -First 1
if ($p) { $p.CloseMainWindow() | Out-Null }
for ($i=0; $i -lt 60; $i++) { if (-not (Get-Ours)) { break }; Start-Sleep 1 }
$left = Get-Ours
if ($left) { Write-Host "force-killing leftovers:" ($left | % Name); $left | Stop-Process -Force }
Write-Host 'done'
