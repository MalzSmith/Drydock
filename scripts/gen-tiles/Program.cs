using System.Globalization;
using System.Reflection;
using System.Text;

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: gen-tiles <out.json>");
    return 1;
}

var root = Environment.GetEnvironmentVariable("SE_GAME_ROOT") ?? @"C:\Program Files (x86)\Steam\steamapps\common\SpaceEngineers";
var bin = Path.Combine(root, "Bin64");
if (!File.Exists(Path.Combine(bin, "Sandbox.Game.dll")))
{
    Console.Error.WriteLine($"Space Engineers not found in {root}. Set SE_GAME_ROOT to the game folder.");
    return 1;
}

AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
{
    var path = Path.Combine(bin, new AssemblyName(e.Name).Name + ".dll");
    return File.Exists(path) ? Assembly.LoadFrom(path) : null;
};

var game = Assembly.LoadFrom(Path.Combine(bin, "Sandbox.Game.dll"));
var vrageGame = Assembly.LoadFrom(Path.Combine(bin, "VRage.Game.dll"));
var defs = game.GetType("Sandbox.Definitions.MyCubeGridDefinitions", true);
var topology = vrageGame.GetType("VRage.Game.MyCubeTopology", true);
var getInfo = defs.GetMethod("GetTopologyInfo", BindingFlags.Public | BindingFlags.Static);

static object Get(object o, string name) => o.GetType().GetField(name, BindingFlags.Public | BindingFlags.Instance).GetValue(o);
static float Fl(object o, string name) => (float)Get(o, name);
static string F(float v) => MathF.Round(v, 6).ToString("R", CultureInfo.InvariantCulture);
static string V(object v) => $"[{F(Fl(v, "X"))},{F(Fl(v, "Y"))},{F(Fl(v, "Z"))}]";

static string IdString(object id)
{
    try
    {
        var s = (string)id.GetType().GetProperty("String").GetValue(id);
        return string.IsNullOrEmpty(s) ? null : s;
    }
    catch (TargetInvocationException)
    {
        return null;
    }
}

static string M(object m) => "[" + string.Join(",", new[] { "M11", "M12", "M13", "M21", "M22", "M23", "M31", "M32", "M33", "M41", "M42", "M43" }.Select(c => F(Fl(m, c)))) + "]";

var vmath = Assembly.LoadFrom(Path.Combine(bin, "VRage.Math.dll"));
var dirType = vmath.GetType("VRageMath.Base6Directions+Direction", true);
var orientType = vmath.GetType("VRageMath.MyBlockOrientation", true);
var unique = defs.GetMethod("GetTopologyUniqueOrientation", BindingFlags.Public | BindingFlags.Static);
var gridOrient = (System.Collections.IDictionary)defs.GetField("TileGridOrientations", BindingFlags.Public | BindingFlags.Static).GetValue(null);
static int Axis(int d) => d / 2;

var names = Enum.GetNames(topology);
var sb = new StringBuilder("{\"v\":2,\"topologies\":[");
for (int t = 0; t < names.Length; t++)
{
    var e = getInfo.Invoke(null, new[] { Enum.ToObject(topology, t) });
    var tiles = (Array)Get(e, "Tiles");
    var edges = (Array)Get(e, "Edges");
    if (t > 0) sb.Append(',');
    sb.Append("{\"name\":\"").Append(names[t]).Append("\",\"tiles\":[");
    for (int i = 0; i < tiles.Length; i++)
    {
        var d = tiles.GetValue(i);
        var m = Get(d, "LocalMatrix");
        if (i > 0) sb.Append(',');
        var id = IdString(Get(d, "Id"));
        sb.Append("{\"m\":").Append(M(m));
        sb.Append(",\"n\":").Append(V(Get(d, "Normal")));
        int flags = ((bool)Get(d, "FullQuad") ? 1 : 0) | ((bool)Get(d, "DontOffsetTexture") ? 2 : 0) | (id == null ? 4 : 0);
        sb.Append(",\"f\":").Append(flags);
        if (id != null) sb.Append(",\"id\":\"").Append(id).Append('"');
        sb.Append('}');
    }
    sb.Append("],\"edges\":[");
    for (int i = 0; i < edges.Length; i++)
    {
        var d = edges.GetValue(i);
        if (i > 0) sb.Append(',');
        sb.Append('[').Append(V(Get(d, "Point0"))).Append(',').Append(V(Get(d, "Point1"))).Append(']');
    }
    sb.Append("],\"uniq\":[");
    for (int k = 0; k < 36; k++)
    {
        if (k > 0) sb.Append(',');
        int fw = k / 6, up = k % 6;
        if (Axis(fw) == Axis(up))
        {
            sb.Append("null");
            continue;
        }
        var o = Activator.CreateInstance(orientType, Enum.ToObject(dirType, fw), Enum.ToObject(dirType, up));
        var r = unique.Invoke(null, new[] { Enum.ToObject(topology, t), o });
        sb.Append(Convert.ToInt32(Get(r, "Forward")) * 6 + Convert.ToInt32(Get(r, "Up")));
    }
    sb.Append("]}");
}
sb.Append("],\"grid\":{");
bool firstId = true;
foreach (System.Collections.DictionaryEntry kv in gridOrient)
{
    if (!firstId) sb.Append(',');
    firstId = false;
    sb.Append('"').Append(IdString(kv.Key)).Append("\":[");
    bool firstDir = true;
    foreach (System.Collections.DictionaryEntry dv in (System.Collections.IDictionary)kv.Value)
    {
        if (!firstDir) sb.Append(',');
        firstDir = false;
        var s3 = dv.Key;
        string I(string n) => ((int)s3.GetType().GetField(n).GetValue(s3)).ToString(CultureInfo.InvariantCulture);
        sb.Append("{\"s\":[").Append(I("X")).Append(',').Append(I("Y")).Append(',').Append(I("Z")).Append("],\"m\":").Append(M(Get(dv.Value, "LocalMatrix"))).Append('}');
    }
    sb.Append(']');
}
sb.Append("}}");
File.WriteAllText(args[0], sb.ToString());
Console.WriteLine($"{names.Length} topologies -> {args[0]}");
return 0;
