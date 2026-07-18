#!/usr/bin/env node
/**
 * sync-core.mjs — align this repo's pnpm catalog with a sigx core version.
 *
 * The sigx ecosystem pins core packages (`@sigx/reactivity`, …) to a SINGLE
 * minor so pnpm hoists exactly one physical copy — two copies break reactivity
 * (module-local reactive state). Each repo centralises those pins in the
 * `catalog:` block of `pnpm-workspace.yaml`, so a core bump is a one-line edit.
 *
 * This script performs that edit automatically:
 *   node scripts/sync-core.mjs            # align to the latest published core
 *   node scripts/sync-core.mjs 0.13.0     # align to an explicit version
 *   node scripts/sync-core.mjs 0.13       # minor is enough; patch is ignored
 *   node scripts/sync-core.mjs --check     # exit 1 if a change WOULD be made (CI drift guard)
 *
 * It rewrites only CORE packages (published from signalxjs/core) to `^X.Y.0`
 * (== `>=X.Y.0 <X.(Y+1).0`, one minor — the single-copy guarantee). It never
 * touches sibling-ecosystem entries (`@sigx/router`, `@sigx/lynx-*`, …) that may
 * also live in the catalog. Formatting and comments are preserved (line-based
 * edit). It does NOT run install/build/test — CI (core-sync.yml) does that and
 * opens the PR; run those yourself when using it locally.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The packages published from signalxjs/core. Only these are rewritten.
// Keep in sync with SIGX_CORE_PACKAGES in @sigx/vite.
const CORE_PACKAGES = new Set([
    'sigx',
    '@sigx/reactivity',
    '@sigx/runtime-core',
    '@sigx/runtime-dom',
    '@sigx/server-renderer',
    '@sigx/server',
    '@sigx/ssr-islands',
    '@sigx/resume',
    '@sigx/cache',
    '@sigx/vite',
]);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const wsPath = join(repoRoot, 'pnpm-workspace.yaml');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const versionArg = args.find((a) => !a.startsWith('-'));

/** Resolve the target minor as `^X.Y.0`, from an arg or the npm registry. */
function resolveRange() {
    let v = versionArg;
    if (!v) {
        v = execSync('npm view @sigx/reactivity version', { encoding: 'utf8' }).trim();
    }
    const m = /^v?(\d+)\.(\d+)/.exec(v);
    if (!m) {
        console.error(`sync-core: cannot parse a version from "${v}"`);
        process.exit(2);
    }
    return { range: `^${m[1]}.${m[2]}.0`, display: `${m[1]}.${m[2]}` };
}

if (!existsSync(wsPath)) {
    console.error(`sync-core: no pnpm-workspace.yaml at ${wsPath}`);
    process.exit(2);
}

const { range, display } = resolveRange();
const src = readFileSync(wsPath, 'utf8');
const lines = src.split('\n');

// Match catalog entries only while inside a `catalog:`/`catalogs:` block.
// A catalog entry line looks like:  <indent>"@sigx/reactivity": ^0.12.0
//                              or:  <indent>sigx: ^0.12.0
// The value may be double-quoted, single-quoted (and a quoted value may contain
// spaces, e.g. a wide range ">=0.11.0 <0.13.0" we want to tighten), or bare.
const blockHeader = /^(catalog|catalogs)\s*:/;
const entry = /^(\s+)(["']?)([@a-zA-Z0-9._/-]+)\2\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))(\s*(?:#.*)?)$/;

let inCatalog = false;
let catalogIndent = -1;
const changes = [];

const out = lines.map((line) => {
    if (blockHeader.test(line)) {
        inCatalog = true;
        catalogIndent = line.search(/\S/);
        return line;
    }
    if (inCatalog) {
        const indent = line.search(/\S/);
        // A non-blank line at or below the block header's indent ends the block.
        if (line.trim() !== '' && indent <= catalogIndent && !entry.test(line)) {
            inCatalog = false;
        }
    }
    if (!inCatalog) return line;

    const m = entry.exec(line);
    if (!m) return line;
    const [, ind, nameQ, name, dqVal, sqVal, uqVal, trailing] = m;
    if (!CORE_PACKAGES.has(name)) return line; // leave sibling entries alone
    const ver = dqVal ?? sqVal ?? uqVal;
    const valQ = dqVal !== undefined ? '"' : sqVal !== undefined ? "'" : '';
    if (ver === range) return line; // already aligned
    changes.push({ name, from: ver, to: range });
    return `${ind}${nameQ}${name}${nameQ}: ${valQ}${range}${valQ}${trailing ?? ''}`;
});

if (changes.length === 0) {
    console.log(`sync-core: catalog already aligned to core ${display} (no change).`);
    process.exit(0);
}

console.log(`sync-core: align catalog to core ${display}:`);
for (const c of changes) console.log(`  ${c.name}: ${c.from} -> ${c.to}`);

if (checkOnly) {
    console.error('sync-core: --check found drift (see above). Run without --check to apply.');
    process.exit(1);
}

writeFileSync(wsPath, out.join('\n'));
console.log(`\nsync-core: wrote ${wsPath}. Next: pnpm install && pnpm build && pnpm typecheck && pnpm test`);
