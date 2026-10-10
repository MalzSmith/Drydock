# Setup (E) and static checks (S)

A full run took 25–40 minutes per runner on the reference machine; L9/L10 (workshop and game scans) take under a minute each when the disk cache is warm.

Execution order for the whole run: E1–E4 → S1–S5 (runner A only) → E5–E6 → B1–B2 → T1, T2, T2b, T3–T5 → U1–U6 → O1–O9 → L1–L6 → G1–G7 → M1–M4 → L7–L14 → M5–M9 → G8 → R1–R13 → X1–X13 → C1–C20 → I1–I4 → N1–N5 → P0–P7 → F1–Fn (focus.md) → Z1–Z4 → report.

## E Setup (both runners)

**E1 Environment.** The coordinator gives you `DD_SKILL` (absolute skill folder), your runner id and the run folder. Run once:
```sh
sh "<DD_SKILL>/scripts/env.sh" <A|B> "<run dir>"
```
Then start every later command with `. "<DD_SKILL>/work/<A|B>/env.sh"`. Record the file: `cp "$DD_WORK/env.sh" "$DD_OUT/logs/env.txt"`. Pass: the file exists, `DD_WORK` is under `$DD_SKILL/work`, `DD_OUT` under `$DD_RUN`, and the directories exist.

**E2 Tool versions.**
```sh
{ node -v; git -C "$DD_REPO" rev-parse HEAD; node -p "require('$DD_REPO/node_modules/playwright-core/package.json').version"; ls "C:/Program Files (x86)/Microsoft/Edge/Application" | grep -E '^[0-9]'; } > "$DD_OUT/logs/E2.txt" 2>&1
```
Pass: Node ≥ 22.12, playwright-core present, an Edge version folder present.

**E3 Repository baseline.**
```sh
git -C "$DD_REPO" status --porcelain=v1 --ignored > "$DD_OUT/logs/git-status-before.txt"
git -C "$DD_REPO" diff | sha256sum > "$DD_OUT/logs/git-diff-before.sha256"
git -C "$DD_REPO" diff --stat > "$DD_OUT/logs/git-diff-stat.txt"
ls -la --time-style=full-iso "$DD_REPO/dist" > "$DD_OUT/logs/dist-before.txt" 2>&1
```
Pass: commands succeed. Note in the report the commit and which files are modified. `work/` and `reports/` of the skill appear as ignored directories; that is expected.

**E4 Fixtures.**
```sh
node --check "$DD_SKILL/scripts/lib.mjs" && node --check "$DD_SKILL/scripts/driver.mjs" && node "$DD_SKILL/scripts/make-fixtures.mjs" > "$DD_OUT/logs/E4.txt" 2>&1; cat "$DD_OUT/logs/E4.txt"
cp "$DD_FIX/manifest.json" "$DD_OUT/logs/manifest.json"
```
Pass: exit 0; `manifest.json` exists; at least 3 pairs (2 local-based + the synthetic one); `cloud` lists every cloud folder with `gz: true` (a cloud file that is not gzipped is an observation, not a failure); `mod` is not null when the workshop exists. Evidence: `E4.txt`, `logs/manifest.json`.

**E5 App server.** Runner A only after S4 (it serves the build from S4); runner B now. Start it in the background (agent background facility, or `&` with output redirected), from the checkout so Vite finds `vite.config.ts`:
```sh
cd "$DD_REPO" && node node_modules/vite/bin/vite.js preview --outDir "$DD_DIST" --host 127.0.0.1 --port "$DD_PORT" --strictPort > "$DD_OUT/logs/server.log" 2>&1
cd "$DD_REPO" && node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$DD_PORT" --strictPort > "$DD_OUT/logs/server.log" 2>&1
```
The first line is runner A's, the second runner B's. Wait until `curl -s -o /dev/null -w '%{http_code}' "$DD_BASE/"` prints `200`. Pass: 200 within 60 s and `server.log` shows the port. Record the listening PID: `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $DD_PORT -State Listen).OwningProcess" > "$DD_WORK/server.pid"`.

**E6 Driver.** Start in the background with the environment sourced:
```sh
cd "$DD_SKILL/scripts" && node driver.mjs > "$DD_OUT/logs/driver.log" 2>&1
```
Then wait until `echo 'return 1' | sh "$DD_SKILL/scripts/dd.sh"` returns `"ok": true`. Record the driver PID the same way as in E5 with `$DD_DRIVER_PORT` into `$DD_WORK/driver.pid`. Pass: the driver answers. (The browser is opened in B1.)

## S Static checks (runner A only; runner B: SKIP, owned by runner A)

**S1 Unit tests.**
```sh
cd "$DD_REPO" && npx --no -- vitest run --reporter=verbose > "$DD_OUT/logs/S1-vitest.txt" 2>&1; echo "exit $?" >> "$DD_OUT/logs/S1-vitest.txt"
grep -nE "decodeBlueprint|reads plain and gzip|reads the start of plain|cloud blueprints|gzip-compressed bp.sbc|game assets|Test Files|Tests " "$DD_OUT/logs/S1-vitest.txt"
```
Pass: exit 0, no failed test; these tests are present and passed: `decodeBlueprint > reads plain and gzip-compressed cloud blueprints to the same text`, `decodeBlueprint > reads the start of plain and gzip-compressed files`, `scanSource with cloud blueprints > lists gzip-compressed bp.sbc files with name and grid size`. Record whether the `game assets` suite (`describe.skipIf(!have)('game assets')` in `test/assets.test.ts`) ran or was skipped; with the game installed it must run (a skip with the game present is a FAIL).

**S2 Type check.**
```sh
cd "$DD_REPO" && npx --no -- tsc --noEmit -p . > "$DD_OUT/logs/S2-tsc.txt" 2>&1; echo "exit $?" >> "$DD_OUT/logs/S2-tsc.txt"
```
Pass: exit 0 and no diagnostics.

**S3 Locale files.**
```sh
cd "$DD_REPO" && node -e "
const fs=require('fs');const P=new Set(['zero','one','two','few','many','other']);
const isPl=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length>0&&Object.keys(v).every(k=>P.has(k));
const flat=(o,p='',out={})=>{for(const[k,v]of Object.entries(o)){const kk=p?p+'.'+k:k;if(v&&typeof v==='object'&&!Array.isArray(v)&&!isPl(v))flat(v,kk,out);else out[kk]=v}return out};
const ph=v=>[...new Set((isPl(v)?Object.values(v).join(' '):String(v)).match(/\{\w+\}/g)||[])].filter(x=>x!=='{count}').sort().join();
const L=fs.readdirSync('src/locales').filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5));const m={};for(const l of L)m[l]=flat(JSON.parse(fs.readFileSync('src/locales/'+l+'.json','utf8')));
const r={};for(const l of L){const miss=Object.keys(m.en).filter(k=>!(k in m[l])),extra=Object.keys(m[l]).filter(k=>!(k in m.en));
const noOther=Object.entries(m[l]).filter(([,v])=>isPl(v)&&!('other' in v)).map(([k])=>k);
const empty=Object.entries(m[l]).filter(([,v])=>typeof v==='string'&&!v.trim()).map(([k])=>k);
const phDiff=Object.keys(m.en).filter(k=>k in m[l]&&ph(m.en[k])!==ph(m[l][k]));
r[l]={keys:Object.keys(m[l]).length,miss,extra,noOther,empty,phDiff}}
console.log(JSON.stringify(r,null,1))" > "$DD_OUT/logs/S3-locales.json"
```
Pass: for every locale `miss`, `extra`, `noOther` and `empty` are empty. `phDiff` lists keys whose `{placeholders}` differ from English; each entry must be checked by reading both strings (a translation may legitimately drop `{count}`, which is excluded already); any placeholder that is missing so a value would not be shown is a defect. Also check that `index.html` contains every locale in the narrow-page string table (`grep -c '"zh-Hant"' index.html` ≥ 1, same for the others).

**S4 Production build (into the work folder).**
```sh
cd "$DD_REPO" && node node_modules/vite/bin/vite.js build --outDir "$DD_DIST" --emptyOutDir > "$DD_OUT/logs/S4-build.txt" 2>&1; echo "exit $?" >> "$DD_OUT/logs/S4-build.txt"
ls -R "$DD_DIST" > "$DD_OUT/logs/S4-dist-files.txt"
node -e "const fs=require('fs'),z=require('zlib'),p=require('path');const d=process.argv[1]+'/assets';for(const f of fs.readdirSync(d).filter(f=>f.endsWith('.js')))console.log(f,fs.statSync(p.join(d,f)).size,'gzip',z.gzipSync(fs.readFileSync(p.join(d,f))).length)" "$DD_DIST" > "$DD_OUT/logs/S4-sizes.txt"
grep -rlIF -e "$(cygpath -m "$USERPROFILE")" -e "$(cygpath -w "$USERPROFILE")" "$DD_DIST" > "$DD_OUT/logs/S4-privacy.txt"; echo "matches: $(wc -l < "$DD_OUT/logs/S4-privacy.txt")"
```
Pass: exit 0; `$DD_DIST` contains `index.html`, `assets/`, `count.js`, `favicon.svg`, `THIRD_PARTY_NOTICES.txt`; the privacy grep finds no file (the build must not embed local paths or the user name); `git -C "$DD_REPO" status --porcelain=v1 --ignored` equals `git-status-before.txt` and `dist-before.txt` is unchanged (the repo's `dist/` was not touched). Record the gzip sizes; the architecture target is a JS bundle under 200 kB gzip without the data files: report the main entry chunk size as information, flag it only if clearly above.

**S5 The repo's own `npm run build` is not run** (it would write `dist/` in the checkout). Mark S5 as SKIP with the note `covered by S2 + S4`.
