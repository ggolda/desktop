# Process sampler for the benchmark harness (docs/rework/benchmarking.md).
# Emits one JSON line per tick on stdout:
#   { t, fg, p: [ {pid, ppid, name, ws, pb, cpu, ts} ], cmd: [ {pid, cmd} ] }
#   fg  = PID owning the foreground window
#   ws  = private working set (bytes)  -- Task Manager "Memory" column
#   pb  = private bytes / commit (bytes)
#   cpu = cumulative processor time (100 ns ticks); ts = counter timestamp (100 ns)
# Command lines are emitted once per newly seen PID (used to read Chromium --type=).
param(
  [string]$Names = 'electron,obs64,obs-browser-page,obs-ffmpeg-mux,win-streamlabs-vst,crash-handler-process,crashpad_handler',
  [int]$IntervalMs = 1000
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BenchFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static uint Pid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
}
'@
$filter = ($Names.Split(',') | ForEach-Object { "Name LIKE '$($_.Trim())%'" }) -join ' OR '
$seen = @{}
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$next = 0
while ($true) {
  $rows = Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -Filter $filter
  $procs = @()
  $cmds = @()
  foreach ($r in $rows) {
    $procId = [int]$r.IDProcess
    if ($procId -eq 0) { continue }
    $procs += [pscustomobject]@{
      pid  = $procId
      ppid = [int]$r.CreatingProcessID
      name = ($r.Name -replace '#\d+$', '')
      ws   = [int64]$r.WorkingSetPrivate
      pb   = [int64]$r.PrivateBytes
      cpu  = [int64]$r.PercentProcessorTime
      ts   = [int64]$r.Timestamp_Sys100NS
    }
    if (-not $seen.ContainsKey($procId)) {
      $seen[$procId] = $true
      try {
        $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$procId"
        if ($p) { $cmds += [pscustomobject]@{ pid = $procId; cmd = [string]$p.CommandLine } }
      } catch {}
    }
  }
  $line = [pscustomobject]@{
    t   = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    fg  = [BenchFg]::Pid()
    p   = $procs
    cmd = $cmds
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $line -Compress -Depth 4))
  [Console]::Out.Flush()
  $next += $IntervalMs
  $wait = $next - $sw.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
}
