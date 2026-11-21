// A working token-radar-01 entry (Node 22, standard library only), radar-3.
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every pre-token protocol with the radar-3 model in
// lib/model.ts, writes the ranked board to /output/board.json, and copies this
// repository's dashboard/ and screenshots/ to /output. Last, it writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// radar-3's model is a fitted size curve, validated out of sample on the
// snapshot's own launched tokens before it ranks anything: the leave-one-out
// typical miss, the walk-forward miss, the token-odds Brier score, the
// range honesty and a bootstrap of the size slope are all computed at
// runtime, in lib/model.ts, and shown in the dashboard. Every board row
// carries a token-launch odds and a FARM / MARGINAL / SKIP verdict with
// net-of-fees economics, and the dashboard accounts for all 758 snapshot
// protocols, so nothing is hidden.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board. It covers
// the watchlist, states the model, shows the evidence, and gives every
// protocol a farm plan.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The first 8 hex characters of this file's SHA-256: the dashboard shows it, so the numbers are traceable to this source. */
const mainChecksum = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 8);

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot, undefined, mainChecksum);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
// The validation is the entry's claim: the fitted curve must beat the flat
// median multiple out of sample, in both tests, or the board is not worth
// handing in. Refuse rather than submit a model that loses to its baseline.
const v = radar.validation;
if (!(v.loo_model_miss < v.loo_flat_miss && v.walkforward_model_miss < v.walkforward_flat_miss)) {
  process.stderr.write(
    `token radar: the fitted curve loses to the flat baseline out of sample (LOO x${v.loo_model_miss} vs x${v.loo_flat_miss}, walk-forward x${v.walkforward_model_miss} vs x${v.walkforward_flat_miss}): refuse rather than hand in a model that loses to its baseline\n`,
  );
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardJson = `${JSON.stringify({ rows: board })}\n`;
if (Buffer.byteLength(boardJson, 'utf8') > 8_388_608) {
  process.stderr.write(`token radar: board.json is over the gate's 8 MiB cap: refuse rather than hand in a board the scorer drops\n`);
  process.exit(1);
}
writeFileSync(join(out, 'board.json'), boardJson);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: verdicts FARM ${radar.verdict_farm_n} / MARGINAL ${radar.verdict_marginal_n} / SKIP ${radar.verdict_skip_n}\n` +
    `token radar: validation LOO miss x${v.loo_model_miss} vs flat x${v.loo_flat_miss} (n=${v.launched_n}), walk-forward x${v.walkforward_model_miss} vs x${v.walkforward_flat_miss} (n=${v.walkforward_test_n}), odds Brier ${v.odds_brier_model} vs base ${v.odds_brier_base}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
