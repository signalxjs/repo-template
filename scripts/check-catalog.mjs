#!/usr/bin/env node
/**
 * check-catalog.mjs — CI guard (`pnpm verify:catalog`). Fails if:
 *   1. any workspace package declares a CORE dep with an inline version instead
 *      of `"catalog:"` (drift — the whole point is one source of truth), or
 *   2. a `catalog:` core entry is NOT a single-minor caret `^X.Y.0`
 *      (a wider range like `>=0.11 <0.13` re-opens the two-copies hazard).
 *
 * Wire into ci.yml. Generalises lynx's check-versions.js to the catalog model.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_PACKAGES = new Set([
    'sigx', '@sigx/reactivity', '@sigx/runtime-core', '@sigx/runtime-dom',
    '@sigx/server-renderer', '@sigx/server', '@sigx/ssr-islands', '@sigx/resume',
    '@sigx/cache', '@sigx/vite',
]);
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const SINGLE_MINOR = /^\^\d+\.\d+\.0$/; // ^X.Y.0 — one minor

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

// 1. Every core dep in every package.json must be exactly "catalog:".
function scanPkgDir(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (!statSync(p).isDirectory()) continue;
        const pj = join(p, 'package.json');
        if (!existsSync(pj)) continue;
        const pkg = JSON.parse(readFileSync(pj, 'utf8'));
        for (const field of DEP_FIELDS) {
            for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
                if (CORE_PACKAGES.has(name) && spec !== 'catalog:') {
                    errors.push(`${pkg.name} ${field}["${name}"] = "${spec}" (must be "catalog:")`);
                }
            }
        }
    }
}
for (const base of ['packages', 'app', 'apps', 'examples']) {
    const d = join(repoRoot, base);
    if (existsSync(d)) scanPkgDir(d);
}

// 2. Catalog core entries must be single-minor caret. Parse pnpm-workspace.yaml
//    leniently (the entries this cares about are simple `name: ^x.y.z` lines).
//    A repo with no workspace file has no catalog to police — skip part 2.
const wsPath = join(repoRoot, 'pnpm-workspace.yaml');
const ws = existsSync(wsPath) ? readFileSync(wsPath, 'utf8') : '';
// Value may be quoted (and a quoted value may contain spaces, e.g. a wide range
// like ">=0.11.0 <0.13.0") or bare. Capture all three forms so wide ranges are
// caught, not silently skipped.
const entryRe = /^\s+(["']?)([@a-zA-Z0-9._/-]+)\1\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/;
let inCatalog = false;
for (const line of ws.split('\n')) {
    if (/^(catalog|catalogs)\s*:/.test(line)) { inCatalog = true; continue; }
    if (inCatalog && line.trim() !== '' && /^\S/.test(line)) inCatalog = false;
    if (!inCatalog) continue;
    const m = entryRe.exec(line);
    if (!m) continue;
    const name = m[2];
    const ver = m[3] ?? m[4] ?? m[5];
    if (CORE_PACKAGES.has(name) && !SINGLE_MINOR.test(ver)) {
        errors.push(`catalog["${name}"] = "${ver}" (must be single-minor ^X.Y.0 to keep one copy hoisted)`);
    }
}

if (errors.length) {
    console.error('verify:catalog FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
}
console.log('verify:catalog OK — all core deps go through a single-minor catalog.');
