param([string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);public struct R{public int L,T,Ri,B;}}'
[W]::SetProcessDPIAware()|Out-Null
$p=Get-Process electron | ? { $_.MainWindowHandle -ne 0 } | select -First 1
[W]::ShowWindow($p.MainWindowHandle,6)|Out-Null; Start-Sleep -Milliseconds 500; [W]::ShowWindow($p.MainWindowHandle,9)|Out-Null; [W]::SetForegroundWindow($p.MainWindowHandle)|Out-Null; Start-Sleep -Seconds 6
$r=New-Object W+R; [W]::GetWindowRect($p.MainWindowHandle,[ref]$r)|Out-Null
$b=New-Object Drawing.Bitmap ($r.Ri-$r.L),($r.B-$r.T); $g=[Drawing.Graphics]::FromImage($b); $dc=$g.GetHdc(); [W]::PrintWindow($p.MainWindowHandle,$dc,2)|Out-Null; $g.ReleaseHdc($dc); $b.Save($Out)
