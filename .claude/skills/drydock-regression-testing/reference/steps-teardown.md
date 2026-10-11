# Teardown (Z) — always run, also after failures

**Z1 Close the browsers and the driver.**
```sh
echo 'for (const k of Object.keys(s)) if (s[k]?.ctx) await lib.close(s[k]); await lib.close(s); setTimeout(() => process.exit(0), 200); return "bye"' | sh "$DD_SKILL/scripts/dd.sh"
```
Then stop any browser process still using one of your profiles, and nothing else (`msedge.exe` for runners A and B, `firefox.exe` for runner C):
```sh
EXE="$([ "$DD_BROWSER" = firefox ] && echo firefox.exe || echo msedge.exe)"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='$EXE'\" | Where-Object { \$_.CommandLine -like '*drydock-regression-testing?work?$DD_RUNNER?profile*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```
The match is on your own work directory (`work/A/profile…`, `work/B/profile…` or `work/C/profile…`, `?` matching either slash), which appears in the profile argument of your browsers only (`--user-data-dir` for Edge, `-profile` for Firefox), so a Firefox or Edge the user has open is never touched.

**Z2 Stop your servers, by your ports only.**
```sh
for p in "$DD_PORT" "$DD_DRIVER_PORT"; do powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).OwningProcess"; done
```
Compare the printed PIDs with `$DD_WORK/server.pid` and `$DD_WORK/driver.pid`. Stop only a PID that matches: `powershell -NoProfile -Command "Stop-Process -Id <pid> -Force"`. Run the loop again. Pass: it prints nothing (nothing listens on your ports). A listener whose PID is not yours is reported, not stopped.

**Z3 Repository untouched.**
```sh
git -C "$DD_REPO" status --porcelain=v1 --ignored > "$DD_OUT/logs/git-status-after.txt"
git -C "$DD_REPO" diff | sha256sum > "$DD_OUT/logs/git-diff-after.sha256"
ls -la --time-style=full-iso "$DD_REPO/dist" > "$DD_OUT/logs/dist-after.txt" 2>&1
diff "$DD_OUT/logs/git-status-before.txt" "$DD_OUT/logs/git-status-after.txt" && diff "$DD_OUT/logs/git-diff-before.sha256" "$DD_OUT/logs/git-diff-after.sha256" && diff "$DD_OUT/logs/dist-before.txt" "$DD_OUT/logs/dist-after.txt" && echo "repo unchanged"
```
Pass: `repo unchanged`. The skill's `work/` and `reports/` folders are ignored and appear identically in both listings. A difference that comes from a developer editing the checkout during the run is reported as an observation; a difference caused by the run is a FAIL of the run itself.

**Z4 Clean up.** Delete your whole work directory (profiles, fixtures, build, pid files): `rm -rf "$DD_WORK"`. Keep `$DD_OUT` (it is the run's evidence; the coordinator prunes old runs). Delete nothing outside your own `$DD_WORK`.
