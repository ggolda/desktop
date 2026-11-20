# Gracefully closes the NEW (reborn) app started for the parity loop (not the legacy one) and waits
# for OBS (obs64 can take ~25 s to exit).
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$procs = Get-Process electron -ErrorAction SilentlyContinue | ? { $_.Path -like "$repo*" }
$main = $procs | ? { $_.MainWindowHandle -ne 0 } | select -First 1
if ($main) { $main.CloseMainWindow() | Out-Null }
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  $left = @(Get-Process electron -ErrorAction SilentlyContinue | ? { $_.Path -like "$repo*" }) + @(Get-Process obs64, crash-handler -ErrorAction SilentlyContinue | ? { $_.Path -like "$repo*" })
  if ($left.Count -eq 0) { Write-Host 'stopped'; exit 0 }
  Start-Sleep -Milliseconds 500
}
Write-Host 'still running:'; $left | % { Write-Host $_.Id $_.ProcessName }
exit 1
