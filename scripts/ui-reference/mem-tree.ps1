# Private working set (MB) of the process tree rooted at -RootPid, per image name, as one JSON line.
param([int]$RootPid)
$all = Get-CimInstance Win32_Process | select ProcessId, ParentProcessId, Name
$ids = New-Object System.Collections.Generic.HashSet[int]; [void]$ids.Add($RootPid)
do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } } while ($ids.Count -ne $n)
$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ? { $ids.Contains([int]$_.IDProcess) }
$by = @{}; foreach ($p in $perf) { $k = ($p.Name -replace '#\d+$', ''); $by[$k] = [double]$by[$k] + [double]$p.WorkingSetPrivate / 1MB }
($by.GetEnumerator() | % { @{ name = $_.Key; mb = [math]::Round($_.Value, 1) } } | ConvertTo-Json -Compress)
