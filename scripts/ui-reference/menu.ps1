# Native popup-menu helper for the legacy main window. Electron Menu.popup() menus are Chromium "views"
# windows (class Chrome_WidgetWin_1, owned by the main process), NOT DOM, so the main window's PrintWindow
# does not contain them. This never reads the real screen.
#   focus                 : bring the app to the foreground (needed for the menu to show)
#   move -X -Y            : SetCursorPos to client CSS px (Menu.popup() without coords opens at the cursor)
#   baseline              : remember currently visible top-level windows of the main process
#   shot -Out f           : PrintWindow the main window + composite every NEW window (= open menu) onto it
#   children -Out prefix  : PrintWindow each NEW large visible window (child dialogs) to <prefix>-N.png
#   close                 : ESC (only if the foreground window belongs to the legacy main process)
param([string]$Action, [int]$X = 0, [int]$Y = 0, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class M{
 public delegate bool EP(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]public static extern bool EnumWindows(EP f,IntPtr l);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]public static extern bool ClientToScreen(IntPtr h,ref P p);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);
 public static void Focus(IntPtr h){keybd_event(0x12,0,0,UIntPtr.Zero);keybd_event(0x12,0,2,UIntPtr.Zero);SetForegroundWindow(h);}  // ALT tap lets us take the foreground
 [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);
 public struct R{public int L,T,Ri,B;} public struct P{public int X,Y;}
 public static List<long> Wins(uint pid){var l=new List<long>();EnumWindows((h,x)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h))l.Add(h.ToInt64());return true;},IntPtr.Zero);return l;}
 public static uint Pid(IntPtr h){uint p;GetWindowThreadProcessId(h,out p);return p;}
}
'@
[M]::SetProcessDPIAware() | Out-Null
# MENU_APP=new targets the new (reborn) app instead of the legacy one
if ($env:MENU_APP -eq 'new') { $p = Get-Process electron | ? { $_.MainWindowHandle -ne 0 -and $_.Path -notlike '*legacy-ref*' -and $_.MainWindowTitle -like 'Streamlabs*' } | select -First 1 }
else { $p = Get-Process electron | ? { $_.MainWindowHandle -ne 0 -and $_.Path -like '*legacy-ref*' } | select -First 1 }
if (-not $p) { throw 'main window not found' }
$pid0 = [uint32]$p.Id
# main window = largest visible top-level window of the process (Process.MainWindowHandle can flip to a dialog)
$h = [IntPtr](@([M]::Wins($pid0) | Sort-Object { $r = New-Object M+R; [M]::GetWindowRect([IntPtr]$_, [ref]$r) | Out-Null; -(($r.Ri-$r.L)*($r.B-$r.T)) })[0])
$base = Join-Path $env:TEMP 'legacy-ref-winbase.txt'
function Shoot($hwnd) {
  $r = New-Object M+R; [M]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $b = New-Object Drawing.Bitmap ($r.Ri-$r.L), ($r.B-$r.T); $g = [Drawing.Graphics]::FromImage($b); $dc = $g.GetHdc()
  [M]::PrintWindow($hwnd, $dc, 2) | Out-Null; $g.ReleaseHdc($dc); return @{ bmp = $b; rect = $r }
}
switch ($Action) {
  'focus' { [M]::Focus($h) }
  'move' { $o = New-Object M+P; [M]::ClientToScreen($h, [ref]$o) | Out-Null; [M]::SetCursorPos($o.X + $X, $o.Y + $Y) | Out-Null }
  'baseline' { [M]::Wins($pid0) | Set-Content $base }
  'close' { if ([M]::Pid([M]::GetForegroundWindow()) -ne $pid0) { [M]::Focus($h); Start-Sleep -Milliseconds 400 }; if ([M]::Pid([M]::GetForegroundWindow()) -eq $pid0) { [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Write-Host 'esc sent' } else { Write-Host 'foreground not ours; ESC skipped' } }
  'children' {
    $old = @(); if (Test-Path $base) { $old = Get-Content $base | % { [long]$_ } }
    $n = 0
    foreach ($w in [M]::Wins($pid0)) {
      if ($w -eq $h.ToInt64() -or $old -contains $w) { continue }
      $s = Shoot ([IntPtr]$w); if ($s.bmp.Width -lt 200 -or $s.bmp.Height -lt 120) { continue }
      $n++; $f = "$Out-$n.png"; $s.bmp.Save($f); Write-Host "$f $($s.bmp.Width)x$($s.bmp.Height)"
    }
    if ($n -eq 0) { Write-Host 'no child windows' }
  }
  'shot' {
    $main = Shoot $h
    $old = @(); if (Test-Path $base) { $old = Get-Content $base | % { [long]$_ } }
    $ov = @()
    foreach ($w in [M]::Wins($pid0)) {
      if ($w -eq $h.ToInt64() -or $old -contains $w) { continue }
      $s = Shoot ([IntPtr]$w); if ($s.bmp.Width -lt 4) { continue }
      $s.bmp.MakeTransparent([Drawing.Color]::Black)  # popup shadow area prints as pure black
      $ov += ,$s
    }
    # canvas = union of the main window and the overlays (a menu may extend past the window edge)
    $L = $main.rect.L; $T = $main.rect.T; $R = $main.rect.Ri; $B = $main.rect.B
    foreach ($s in $ov) { $L = [Math]::Min($L, $s.rect.L); $T = [Math]::Min($T, $s.rect.T); $R = [Math]::Max($R, $s.rect.Ri); $B = [Math]::Max($B, $s.rect.B) }
    $canvas = New-Object Drawing.Bitmap ($R-$L), ($B-$T); $g = [Drawing.Graphics]::FromImage($canvas)
    $g.Clear([Drawing.Color]::FromArgb(255, 20, 20, 20))
    $g.DrawImage($main.bmp, $main.rect.L - $L, $main.rect.T - $T)
    foreach ($s in $ov) { $g.DrawImage($s.bmp, $s.rect.L - $L, $s.rect.T - $T) }
    $canvas.Save($Out); Write-Host "$Out $($canvas.Width)x$($canvas.Height) overlays=$($ov.Count)"
  }
}
