# Real OS mouse input (SetCursorPos + mouse_event) for the preview overlay checks. This proves the
# native OBS display child window passes mouse events through to the DOM overlay (CDP input would not).
# Usage: mouse.ps1 -Cmds "m 500 500; d; m 600 600; u; sleep 100; rd; ru"
#   m x y: move (screen px), d/u: left down/up, rd/ru: right down/up, sleep ms, k <vk> <vk>... not supported
param([string]$Cmds, [string]$Guard = 'desktop')
Add-Type 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);[DllImport("user32.dll")]public static extern void keybd_event(byte vk,byte sc,uint f,UIntPtr e);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);}'
[M]::SetProcessDPIAware() | Out-Null
# Safety: button and key events only go out while the foreground window belongs to the app under test
# (a path containing -Guard). Otherwise they would hit whatever the user has in front.
function Assert-Foreground {
  $pidOut = [uint32]0
  [M]::GetWindowThreadProcessId([M]::GetForegroundWindow(), [ref]$pidOut) | Out-Null
  $p = Get-Process -Id $pidOut -ErrorAction SilentlyContinue
  if (-not $p -or $p.Path -notlike "*$Guard*") { throw "foreground window is not the app under test ($($p.ProcessName)): input skipped" }
}
foreach ($c in $Cmds.Split(';')) {
  $p = $c.Trim().Split(' ')
  switch ($p[0]) {
    'm' { [M]::SetCursorPos([int]$p[1], [int]$p[2]) | Out-Null }
    'd' { Assert-Foreground; [M]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) }
    'u' { [M]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
    'rd' { Assert-Foreground; [M]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero) }
    'ru' { [M]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) }
    'focus' {
      # brings the app under test to the front (ALT tap lets SetForegroundWindow through)
      $w = Get-Process electron -ErrorAction SilentlyContinue | ? { $_.MainWindowHandle -ne 0 -and $_.Path -like "*$Guard*" } | select -First 1
      if (-not $w) { throw 'app under test has no window' }
      [M]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [M]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      [M]::SetForegroundWindow($w.MainWindowHandle) | Out-Null
      Start-Sleep -Milliseconds 300
    }
    'sleep' { Start-Sleep -Milliseconds ([int]$p[1]) }
    'kd' { Assert-Foreground; [M]::keybd_event([byte][int]$p[1], 0, 0, [UIntPtr]::Zero) }
    'ku' { [M]::keybd_event([byte][int]$p[1], 0, 2, [UIntPtr]::Zero) }
  }
}
