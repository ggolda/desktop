# DPI-aware PrintWindow capture of the legacy main window (flag 2 = PW_RENDERFULLCONTENT, includes the OBS child).
# Optional -Width/-Height set the OUTER window size in physical px first (run with --force-device-scale-factor=1).
param([string]$Out, [int]$Width = 0, [int]$Height = 0, [int]$X = 20, [int]$Y = 20)
Add-Type -AssemblyName System.Drawing
Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);public struct R{public int L,T,Ri,B;}}'
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process electron | ? { $_.MainWindowHandle -ne 0 -and $_.Path -like '*legacy-ref*' } | select -First 1
if (-not $p) { throw 'legacy main window not found' }
$h = $p.MainWindowHandle
if ($Width -gt 0) { [W]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $Width, $Height, 0x0044) | Out-Null; Start-Sleep -Milliseconds 1200 }
if ($Out) {
  $r = New-Object W+R; [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $b = New-Object Drawing.Bitmap ($r.Ri-$r.L), ($r.B-$r.T); $g = [Drawing.Graphics]::FromImage($b); $dc = $g.GetHdc()
  [W]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc); $b.Save($Out); Write-Host "$Out $($b.Width)x$($b.Height)"
}
