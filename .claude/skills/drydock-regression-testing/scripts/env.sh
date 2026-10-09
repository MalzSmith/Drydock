#!/bin/sh
# Discovers test data and writes this runner's environment file.
# usage: sh env.sh <A|B> <run dir>      -> writes work/<runner>/env.sh and prints it
# Every later command starts with:  . "<skill>/work/<runner>/env.sh"
set -e
RUNNER="$1"
RUN="$2"
case "$RUNNER" in A|B) ;; *) echo "usage: env.sh <A|B> <run dir>" >&2; exit 2;; esac
[ -d "$RUN" ] || { echo "run dir does not exist: $RUN (create it with: node scripts/run.mjs new)" >&2; exit 2; }

SKILL="$(cygpath -m "$(cd "$(dirname "$0")/.." && pwd)")"
REPO="$(cygpath -m "$(cd "$SKILL/../../.." && pwd)")"
RUN="$(cygpath -m "$(cd "$RUN" && pwd)")"
case "$RUN" in "$SKILL/reports/"*) ;; *) echo "run dir must be inside $SKILL/reports" >&2; exit 2;; esac
[ -f "$REPO/package.json" ] && grep -q '"name": "drydock"' "$REPO/package.json" || { echo "repo not found at $REPO" >&2; exit 2; }

STEAM="$(reg query 'HKCU\Software\Valve\Steam' //v SteamPath 2>/dev/null | sed -n 's/.*REG_SZ *//p' | tr -d '\r')"
STEAM="${STEAM:-C:/Program Files (x86)/Steam}"
GAME="${SE_GAME_ROOT:-$STEAM/steamapps/common/SpaceEngineers}"
[ -d "$GAME/Content/Data" ] || GAME=""
WORKSHOP="$STEAM/steamapps/workshop/content/244850"
if [ ! -d "$WORKSHOP" ] && [ -f "$STEAM/steamapps/libraryfolders.vdf" ]; then
  for lib in $(sed -n 's/.*"path"[[:space:]]*"\([^"]*\)".*/\1/p' "$STEAM/steamapps/libraryfolders.vdf" | sed 's#\\\\#/#g'); do
    [ -d "$lib/steamapps/workshop/content/244850" ] && WORKSHOP="$lib/steamapps/workshop/content/244850" && break
  done
fi
[ -d "$WORKSHOP" ] || WORKSHOP=""
LOCAL_BP="$(cygpath -m "$APPDATA")/SpaceEngineers/Blueprints/local"
[ -d "$LOCAL_BP" ] || LOCAL_BP=""
CLOUD_BP="$(ls -d "$STEAM"/userdata/*/244850/remote/Blueprints/cloud 2>/dev/null | head -1)"

WORK="$SKILL/work/$RUNNER"
if [ "$RUNNER" = A ]; then PORT=4610 DPORT=4611; else PORT=5620 DPORT=5621; fi
mkdir -p "$WORK" "$RUN/$RUNNER/logs" "$RUN/$RUNNER/shots" "$RUN/$RUNNER/files"

ENVFILE="$WORK/env.sh"
{
  echo "export DD_RUNNER='$RUNNER'"
  echo "export DD_SKILL='$SKILL'"
  echo "export DD_REPO='$REPO'"
  echo "export DD_RUN='$RUN'"
  echo "export DD_WORK='$WORK'"
  echo "export DD_OUT='$RUN/$RUNNER'"
  echo "export DD_PROFILE='$WORK/profile'"
  echo "export DD_FIX='$WORK/fixtures'"
  echo "export DD_DIST='$WORK/dist'"
  echo "export DD_PORT=$PORT"
  echo "export DD_DRIVER_PORT=$DPORT"
  echo "export DD_BASE='http://127.0.0.1:$PORT'"
  echo "export SE_GAME_ROOT='$GAME'"
  echo "export DD_WORKSHOP='$WORKSHOP'"
  echo "export DD_LOCAL_BP='$LOCAL_BP'"
  echo "export DD_CLOUD_BP='$CLOUD_BP'"
  echo "export DD_STEAM='$STEAM'"
} > "$ENVFILE"
cat "$ENVFILE"
echo "# written to $ENVFILE"
