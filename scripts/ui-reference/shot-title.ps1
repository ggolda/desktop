# PrintWindow capture (no focus, no input) of the visible top-level window whose title matches -Title
# (wildcard, e.g. 'Settings for*'). Used for the dialog windows, which shot-new.ps1 does not find.
param([string]$Title, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class WT{
 public delegate bool EP(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]public static extern bool EnumWindows(EP f,IntPtr l);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);
 public struct R{public int L,T,Ri,B;}
 public static List<KeyValuePair<IntPtr,string>> All(){var l=new List<KeyValuePair<IntPtr,string>>();EnumWindows((h,x)=>{if(IsWindowVisible(h)){var s=new StringBuilder(256);GetWindowText(h,s,256);if(s.Length>0)l.Add(new KeyValuePair<IntPtr,string>(h,s.ToString()));}return true;},IntPtr.Zero);return l;}
}
'@
[WT]::SetProcessDPIAware() | Out-Null
$w = [WT]::All() | ? { $_.Value -like $Title } | select -First 1
if (-not $w) { throw "window not found: $Title" }
$r = New-Object WT+R; [WT]::GetWindowRect($w.Key, [ref]$r) | Out-Null
$b = New-Object Drawing.Bitmap ($r.Ri-$r.L), ($r.B-$r.T); $g = [Drawing.Graphics]::FromImage($b); $dc = $g.GetHdc()
[WT]::PrintWindow($w.Key, $dc, 2) | Out-Null; $g.ReleaseHdc($dc); $b.Save($Out); Write-Host "$Out $($b.Width)x$($b.Height)"
