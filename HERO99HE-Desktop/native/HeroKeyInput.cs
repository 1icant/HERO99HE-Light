// Local, opt-in lighting input. No hook, text translation, file log or network.
// Only Raw Input keyboards whose device path matches the HERO VID/PID qualify.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.ComponentModel;

static class KeyMap {
    public static string VirtualCode(int vk) {
        if(vk>=0x41&&vk<=0x5a)return "Key"+(char)vk;
        if(vk>=0x30&&vk<=0x39)return "Digit"+(char)vk;
        if(vk>=0x60&&vk<=0x69)return "Numpad"+(vk-0x60);
        if(vk>=0x70&&vk<=0x7b)return "F"+(vk-0x70+1);
        switch(vk){
            case 0x1b:return "Escape";case 8:return "Backspace";case 9:return "Tab";case 13:return "Enter";
            case 0x14:return "CapsLock";case 0x20:return "Space";case 0x21:return "PageUp";case 0x22:return "PageDown";
            case 0x23:return "End";case 0x24:return "Home";case 0x25:return "ArrowLeft";case 0x26:return "ArrowUp";
            case 0x27:return "ArrowRight";case 0x28:return "ArrowDown";case 0x2c:return "PrintScreen";
            case 0x2d:return "Insert";case 0x2e:return "Delete";case 0x5b:return "MetaLeft";case 0x5c:return "MetaRight";
            case 0x6a:return "NumpadMultiply";case 0x6b:return "NumpadAdd";case 0x6d:return "NumpadSubtract";
            case 0x6e:return "NumpadDecimal";case 0x6f:return "NumpadDivide";case 0x90:return "NumLock";case 0x91:return "ScrollLock";
            case 0xa0:return "ShiftLeft";case 0xa1:return "ShiftRight";case 0xa2:return "ControlLeft";case 0xa3:return "ControlRight";
            case 0xa4:return "AltLeft";case 0xa5:return "AltRight";case 0xba:return "Semicolon";case 0xbb:return "Equal";
            case 0xbc:return "Comma";case 0xbd:return "Minus";case 0xbe:return "Period";case 0xbf:return "Slash";
            case 0xc0:return "Backquote";case 0xdb:return "BracketLeft";case 0xdc:return "Backslash";case 0xdd:return "BracketRight";case 0xde:return "Quote";
            default:return null;
        }
    }
    public static string Code(ushort scan, ushort flags, ushort vk) {
        if (scan == 255 || vk == 255 || (flags & 4) != 0) return null;
        bool ext = (flags & 2) != 0;
        if (ext) {
            switch (scan) {
                case 0x1c: return "NumpadEnter"; case 0x1d: return "ControlRight";
                case 0x35: return "NumpadDivide"; case 0x37: return "PrintScreen";
                case 0x38: return "AltRight"; case 0x47: return "Home";
                case 0x48: return "ArrowUp"; case 0x49: return "PageUp";
                case 0x4b: return "ArrowLeft"; case 0x4d: return "ArrowRight";
                case 0x4f: return "End"; case 0x50: return "ArrowDown";
                case 0x51: return "PageDown"; case 0x52: return "Insert";
                case 0x53: return "Delete"; case 0x5b: return "MetaLeft";
                case 0x5c: return "MetaRight"; default: return null;
            }
        }
        string[] row = {"Escape","Digit1","Digit2","Digit3","Digit4","Digit5","Digit6","Digit7","Digit8","Digit9","Digit0","Minus","Equal","Backspace","Tab","KeyQ","KeyW","KeyE","KeyR","KeyT","KeyY","KeyU","KeyI","KeyO","KeyP","BracketLeft","BracketRight","Enter","ControlLeft","KeyA","KeyS","KeyD","KeyF","KeyG","KeyH","KeyJ","KeyK","KeyL","Semicolon","Quote","Backquote","ShiftLeft","Backslash","KeyZ","KeyX","KeyC","KeyV","KeyB","KeyN","KeyM","Comma","Period","Slash","ShiftRight","NumpadMultiply","AltLeft","Space","CapsLock"};
        if (scan >= 1 && scan <= row.Length) return row[scan-1];
        if (scan >= 0x3b && scan <= 0x44) return "F" + (scan - 0x3b + 1);
        switch (scan) {
            case 0x45: return "NumLock"; case 0x46: return "ScrollLock";
            case 0x47: return "Numpad7"; case 0x48: return "Numpad8";
            case 0x49: return "Numpad9"; case 0x4a: return "NumpadSubtract";
            case 0x4b: return "Numpad4"; case 0x4c: return "Numpad5";
            case 0x4d: return "Numpad6"; case 0x4e: return "NumpadAdd";
            case 0x4f: return "Numpad1"; case 0x50: return "Numpad2";
            case 0x51: return "Numpad3"; case 0x52: return "Numpad0";
            case 0x53: return "NumpadDecimal"; case 0x57: return "F11";
            case 0x58: return "F12"; default: return null;
        }
    }
    public static bool Hero(string name) {
        const string id = "VID_372E&PID_103E";
        int at = name == null ? -1 : name.IndexOf(id, StringComparison.OrdinalIgnoreCase);
        if (at < 0) return false;
        int end = at + id.Length;
        return (at == 0 || name[at-1] == '#' || name[at-1] == '&') &&
            (end == name.Length || name[end] == '&' || name[end] == '#');
    }
}
sealed class InputWindow : Form {
    const int WM_INPUT = 0xff, WM_DEVICE = 0xfe;
    [StructLayout(LayoutKind.Sequential)] struct Device { public ushort page, usage; public uint flags; public IntPtr target; }
    [StructLayout(LayoutKind.Sequential)] struct DeviceItem { public IntPtr handle; public uint type; }
    [StructLayout(LayoutKind.Sequential)] struct Header { public uint type, size; public IntPtr device, wparam; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort scan, flags, reserved, vk; public uint message, extra; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterRawInputDevices(Device[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr raw, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder data, ref uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([Out] DeviceItem[] list, ref uint count, uint size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    readonly Dictionary<IntPtr,bool> devices = new Dictionary<IntPtr,bool>();
    readonly HashSet<string> held = new HashSet<string>();
    readonly System.Windows.Forms.Timer watchdog = new System.Windows.Forms.Timer();
    readonly System.Windows.Forms.Timer polling = new System.Windows.Forms.Timer();
    readonly bool poll;
    long heartbeat = Stopwatch.GetTimestamp();
    public InputWindow(bool usePolling) {
        poll=usePolling;
        ShowInTaskbar = false;
        // INPUTSINK | DEVNOTIFY, never NOLEGACY: don't suppress normal typing.
        if (!poll && !RegisterRawInputDevices(new Device[] { new Device { page=1, usage=6, flags=0x2100, target=Handle } }, 1, (uint)Marshal.SizeOf(typeof(Device))))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if(poll){
            // Explicit all-keyboard fallback, high bit only: no text or shared
            // low-bit consumption. Cannot distinguish main/numpad Enter.
            polling.Interval=16;polling.Tick+=delegate{for(int vk=1;vk<255;vk++){
                string code=KeyMap.VirtualCode(vk);if(code==null)continue;
                bool down=(GetAsyncKeyState(vk)&0x8000)!=0;
                if(down?held.Add(code):held.Remove(code))SendKey(code,down);
            }};polling.Start();
            Send("{\"type\":\"ready\",\"devices\":0,\"backend\":\"poll\"}");
        }else Ready();
        watchdog.Interval=1000;
        watchdog.Tick += delegate { if ((Stopwatch.GetTimestamp()-Interlocked.Read(ref heartbeat))/(double)Stopwatch.Frequency > 10) Environment.Exit(0); };
        watchdog.Start();
        Thread commands = new Thread(delegate() {
            try { string line; while ((line=Console.ReadLine()) != null) {
                if (line == "stop") break;
                if (line == "ping") Interlocked.Exchange(ref heartbeat, Stopwatch.GetTimestamp());
            } } catch { }
            Environment.Exit(0); // Parent pipe closed: no orphan listener.
        }); commands.IsBackground=true; commands.Start();
    }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
    bool Match(IntPtr device) {
        bool match; if (devices.TryGetValue(device,out match)) return match;
        uint count=0; GetRawInputDeviceInfo(device,0x20000007,null,ref count);
        match=false;
        if (count>0 && count<4096) {
            StringBuilder name=new StringBuilder((int)count+1);
            if(GetRawInputDeviceInfo(device,0x20000007,name,ref count)!=uint.MaxValue) match=KeyMap.Hero(name.ToString());
        }
        devices[device]=match; return match;
    }
    void Ready() {
        uint n=0,size=(uint)Marshal.SizeOf(typeof(DeviceItem)); int matches=0;
        if(GetRawInputDeviceList(null,ref n,size)!=uint.MaxValue && n<=4096) {
            DeviceItem[] list=new DeviceItem[n];
            uint read=GetRawInputDeviceList(list,ref n,size);
            if(read!=uint.MaxValue) for(int i=0;i<read;i++) if(list[i].type==1 && Match(list[i].handle)) matches++;
        }
        // A single keyboard can expose several Raw Input collections. Do not
        // misclassify collection count as multiple physical keyboards.
        Send("{\"type\":\"ready\",\"devices\":"+matches+"}");
    }
    static void Send(string line) { try { Console.WriteLine(line); Console.Out.Flush(); } catch { Environment.Exit(0); } }
    static void SendKey(string code,bool down){Send("{\"type\":\"key\",\"code\":\""+code+"\",\"down\":"+(down?"true":"false")+"}");}
    protected override void WndProc(ref Message m) {
        if(!poll && m.Msg==WM_DEVICE) { devices.Clear(); held.Clear(); Send("{\"type\":\"reset\"}"); Ready(); }
        if(!poll && m.Msg==WM_INPUT) {
            uint n=0,hs=(uint)Marshal.SizeOf(typeof(Header));
            GetRawInputData(m.LParam,0x10000003,IntPtr.Zero,ref n,hs);
            if(n>=hs+16 && n<=1024) {
                IntPtr buffer=Marshal.AllocHGlobal((int)n);
                try {
                    if(GetRawInputData(m.LParam,0x10000003,buffer,ref n,hs)!=uint.MaxValue) {
                        Header h=(Header)Marshal.PtrToStructure(buffer,typeof(Header));
                        if(h.type==1 && Match(h.device)) {
                            Keyboard k=(Keyboard)Marshal.PtrToStructure(IntPtr.Add(buffer,(int)hs),typeof(Keyboard));
                            string code=KeyMap.Code(k.scan,k.flags,k.vk); bool down=(k.flags&1)==0;
                            if(code!=null && (down?held.Add(code):held.Remove(code)))
                                SendKey(code,down);
                        }
                    }
                } finally { Marshal.FreeHGlobal(buffer); }
            }
        }
        base.WndProc(ref m);
    }
    protected override void Dispose(bool disposing) {
        if(disposing) { watchdog.Dispose();polling.Dispose();if(!poll)RegisterRawInputDevices(new Device[] { new Device {page=1,usage=6,flags=1,target=IntPtr.Zero} },1,(uint)Marshal.SizeOf(typeof(Device))); }
        base.Dispose(disposing);
    }
}
static class Program {
    [STAThread] static int Main(string[] args) {
        if(args.Length==1 && args[0]=="--self-test") {
            if(KeyMap.VirtualCode(0x41)!="KeyA"||KeyMap.VirtualCode(0x1b)!="Escape"||KeyMap.VirtualCode(0x10)!=null||KeyMap.VirtualCode(13)!="Enter"||KeyMap.VirtualCode(0x60)!="Numpad0")return 1;
            if(KeyMap.Code(1,0,27)!="Escape" || KeyMap.Code(0x1c,2,13)!="NumpadEnter" || KeyMap.Code(0x53,0,46)!="NumpadDecimal" || KeyMap.Code(0x53,2,46)!="Delete" || KeyMap.Code(0x2a,2,16)!=null || KeyMap.Code(255,0,255)!=null || !KeyMap.Hero("\\\\?\\HID#VID_372E&PID_103E&MI_00") || KeyMap.Hero("VID_1234&PID_103E")) return 1;
            Console.WriteLine("Raw Input mapping self-test passed; no input listener started.");return 0;
        }
        if(args.Length!=1 || (args[0]!="--listen"&&args[0]!="--listen-poll")) return 2;
        try { using(InputWindow win=new InputWindow(args[0]=="--listen-poll")) Application.Run();return 0; }
        catch(Win32Exception ex){Console.WriteLine("{\"type\":\"error\",\"reason\":\"register\",\"win32\":"+ex.NativeErrorCode+"}");return 1;}
        catch(Exception ex){string reason=ex is UnauthorizedAccessException?"denied":ex is DllNotFoundException?"runtime":"native";Console.WriteLine("{\"type\":\"error\",\"reason\":\""+reason+"\",\"nativeType\":\""+ex.GetType().Name+"\"}");return 1;}
    }
}
