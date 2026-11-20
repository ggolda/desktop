# Burst PrintWindow capture (no focus, no input) of every visible top-level window whose title matches one of
# -Titles (wildcards), every ~-IntervalMs for -DurationMs, starting NOW. Frames are kept in memory; only frames
# whose pixel hash changed (per window) are saved as PNG at the end. Writes frames.csv:
#   epochMs,hwnd,title,w,h,hash,file,colors  (colors = distinct sampled colors, 64 max: ~1 means a blank frame; file empty when the frame equals the previous one of that window)
# -Screen: copies the screen region of the window instead (what the user really sees, other windows included).
# Windows that are fully transparent (layered, alpha 0) count as not visible.
# Prints READY on stdout once the helper is compiled and the loop is about to start.
param([string]$TitlesCsv, [string]$OutDir, [int]$DurationMs = 1500, [int]$IntervalMs = 10, [switch]$Screen)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System;using System.IO;using System.Text;using System.Drawing;using System.Drawing.Imaging;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Diagnostics;
public class Burst{
 delegate bool EP(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]static extern bool EnumWindows(EP f,IntPtr l);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]static extern bool GetLayeredWindowAttributes(IntPtr h,out uint key,out byte alpha,out uint flags);
 [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr h,int i);
 [DllImport("user32.dll")]static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);
 struct R{public int L,T,Ri,B;}
 class F{public long t;public IntPtr h;public string title;public Bitmap b;public long hash;public int colors;}
 static bool Match(string t,string[] pats){foreach(var p in pats){if(p.EndsWith("*")){if(t.StartsWith(p.Substring(0,p.Length-1),StringComparison.OrdinalIgnoreCase))return true;}else if(t.Equals(p,StringComparison.OrdinalIgnoreCase))return true;}return false;}
 static int Colors(Bitmap b){var d=b.LockBits(new Rectangle(0,0,b.Width,b.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);var n=d.Stride*d.Height;var a=new byte[n];Marshal.Copy(d.Scan0,a,0,n);b.UnlockBits(d);var s=new HashSet<int>();int w=b.Width,hh=b.Height,st=d.Stride;for(int y=40;y<hh-12;y+=7)for(int x=12;x<w-12;x+=7){int i=y*st+x*4;s.Add(a[i]|(a[i+1]<<8)|(a[i+2]<<16));if(s.Count>=64)return 64;}return s.Count;}
 static long Hash(Bitmap b){var d=b.LockBits(new Rectangle(0,0,b.Width,b.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);var n=d.Stride*d.Height;var a=new byte[n];Marshal.Copy(d.Scan0,a,0,n);b.UnlockBits(d);long h=1469598103934665603L;for(int i=0;i<n;i+=12){h^=a[i];h*=1099511628211L;}return h;}
 public static void Run(string[] pats,string outDir,int dur,int iv,bool screen){
  SetProcessDPIAware();Directory.CreateDirectory(outDir);
  var sw=Stopwatch.StartNew();long epoch0=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
  var frames=new List<F>();
  while(sw.ElapsedMilliseconds<dur){
   long t0=sw.ElapsedMilliseconds;
   var hs=new List<KeyValuePair<IntPtr,string>>();
   EnumWindows((h,x)=>{if(IsWindowVisible(h)){var s=new StringBuilder(256);GetWindowText(h,s,256);if(s.Length>0&&Match(s.ToString(),pats))hs.Add(new KeyValuePair<IntPtr,string>(h,s.ToString()));}return true;},IntPtr.Zero);
   foreach(var kv in hs){if((GetWindowLong(kv.Key,-20)&0x80000)!=0){uint k;byte al;uint fl;if(GetLayeredWindowAttributes(kv.Key,out k,out al,out fl)&&al==0)continue;}R r;GetWindowRect(kv.Key,out r);int w=r.Ri-r.L,hh=r.B-r.T;if(w<=0||hh<=0)continue;
    var b=new Bitmap(w,hh,PixelFormat.Format32bppArgb);using(var g=Graphics.FromImage(b)){if(screen){g.CopyFromScreen(r.L,r.T,0,0,new Size(w,hh));}else{var dc=g.GetHdc();PrintWindow(kv.Key,dc,2);g.ReleaseHdc(dc);}}
    frames.Add(new F{t=epoch0+t0,h=kv.Key,title=kv.Value,b=b,hash=Hash(b),colors=Colors(b)});}
   long el=sw.ElapsedMilliseconds-t0;if(el<iv)System.Threading.Thread.Sleep((int)(iv-el));
  }
  var last=new Dictionary<IntPtr,long>();var sb=new StringBuilder();int n=0;
  foreach(var f in frames){string file="";long prev;if(!last.TryGetValue(f.h,out prev)||prev!=f.hash){file=string.Format("f{0:D3}_{1}_{2}.png",n++,f.t-epoch0,f.h.ToInt64());f.b.Save(Path.Combine(outDir,file),ImageFormat.Png);last[f.h]=f.hash;}
   sb.AppendLine(string.Format("{0},{1},\"{2}\",{3},{4},{5},{6},{7}",f.t,f.h.ToInt64(),f.title.Replace("\"","'"),f.b.Width,f.b.Height,f.hash,file,f.colors));f.b.Dispose();}
  File.WriteAllText(Path.Combine(outDir,"frames.csv"),sb.ToString());
 }
}
'@
$Titles = $TitlesCsv -split ","
Write-Host READY
[Burst]::Run($Titles, $OutDir, $DurationMs, $IntervalMs, [bool]$Screen)
Write-Host DONE
