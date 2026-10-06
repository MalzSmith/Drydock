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

static bool IsNullId(object id)
{
    try
    {
        return string.IsNullOrEmpty((string)id.GetType().GetProperty("String").GetValue(id));
    }
    catch (TargetInvocationException)
    {
        return true;
    }
}

var names = Enum.GetNames(topology);
var sb = new StringBuilder("{\"v\":1,\"topologies\":[");
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
        var cells = new[] { "M11", "M12", "M13", "M21", "M22", "M23", "M31", "M32", "M33", "M41", "M42", "M43" }.Select(c => F(Fl(m, c)));
        sb.Append("{\"m\":[").Append(string.Join(",", cells)).Append("]");
        sb.Append(",\"n\":").Append(V(Get(d, "Normal")));
        int flags = ((bool)Get(d, "FullQuad") ? 1 : 0) | ((bool)Get(d, "DontOffsetTexture") ? 2 : 0) | (IsNullId(Get(d, "Id")) ? 4 : 0);
        sb.Append(",\"f\":").Append(flags).Append('}');
    }
    sb.Append("],\"edges\":[");
    for (int i = 0; i < edges.Length; i++)
    {
        var d = edges.GetValue(i);
        if (i > 0) sb.Append(',');
        sb.Append('[').Append(V(Get(d, "Point0"))).Append(',').Append(V(Get(d, "Point1"))).Append(']');
    }
    sb.Append("]}");
}
sb.Append("]}");
File.WriteAllText(args[0], sb.ToString());
Console.WriteLine($"{names.Length} topologies -> {args[0]}");
return 0;
