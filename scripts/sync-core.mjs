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
 * also live in the catalog. Formatting is preserved (line-based edit). It does
 * NOT run install/build/test — CI (core-sync.yml) does that and opens the PR;
 * run those yourself when using it locally.
 *
 * It also rewrites the explanatory COMMENT that sits directly above the
 * `catalog:` block — the `# … ^X.Y.0 == >=X.Y.0 <X.(Y+1).0 …` prose that names
 * the pinned minor. Left alone it goes stale on every bump (still citing the old
 * minor), and Copilot's review flags it on every consumer, turning an otherwise
 * clean catalog bump AMBER — a human forced in over a one-line comment. The
 * rewrite is doubly scoped: to the contiguous comment run immediately above the
 * header, and within it to only the version the catalog CURRENTLY pins — so an
 * unrelated caret sharing that block (a Node `^20.19.0` engines note, say) is
 * never touched, and a major bump still moves the old `^0.x` correctly (#41).
 *
 * Because it can ONLY rewrite catalog entries, it refuses to run in a repo whose
 * core deps are pinned inline instead: there would be nothing for the walk to
 * match, and reporting "already aligned" there is a false green that leaves the
 * repo on the old core with no signal at all. Convert those to `"catalog:"` first.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORE_PACKAGES, findInlineCoreDeps, formatInlineCoreDeps } from './lib/core-deps.mjs';

// Match catalog entries only while inside a `catalog:`/`catalogs:` block.
// A catalog entry line looks like:  <indent>"@sigx/reactivity": ^0.12.0
//                              or:  <indent>sigx: ^0.12.0
// The value may be double-quoted, single-quoted (and a quoted value may contain
// spaces, e.g. a wide range ">=0.11.0 <0.13.0" we want to tighten), or bare.
const blockHeader = /^(catalog|catalogs)\s*:/;
const entry = /^(\s+)(["']?)([@a-zA-Z0-9._/-]+)\2\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))(\s*(?:#.*)?)$/;

/** Escape a string for literal use inside a `RegExp`. */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Call `cb(name, ver)` for every entry inside a `catalog:`/`catalogs:` block —
 * the read-only walk, used to learn which core version the catalog currently
 * pins. The write-side walk in `alignCatalog` uses the same block-termination
 * rule (a comment never ends the block); the two must agree.
 */
function forEachCatalogEntry(lines, cb) {
    let inCatalog = false;
    let catalogIndent = -1;
    for (const line of lines) {
        if (blockHeader.test(line)) {
            inCatalog = true;
            catalogIndent = line.search(/\S/);
            continue;
        }
        if (inCatalog) {
            const indent = line.search(/\S/);
            if (line.trim() !== '' && !/^\s*#/.test(line) && indent <= catalogIndent && !entry.test(line)) inCatalog = false;
        }
        if (!inCatalog) continue;
        const m = entry.exec(line);
        if (m) cb(m[3], m[4] ?? m[5] ?? m[6]);
    }
}

/**
 * Align a `pnpm-workspace.yaml`'s core catalog pins — and the explanatory
 * comment above them — to `range`. Pure text transform: no I/O, no process exit,
 * so both the CLI below and the unit tests drive the same code.
 *
 * @param {string} src   the pnpm-workspace.yaml contents
 * @param {string} range the target single-minor caret, `^X.Y.0`
 * @returns {{ text: string, pins: {name:string,from:string,to:string}[], comments: {from:string,to:string}[] }}
 */
export function alignCatalog(src, range) {
    const rm = /^\^(\d+)\.(\d+)\.0$/.exec(range);
    if (!rm) throw new Error(`alignCatalog: range must be a single-minor caret ^X.Y.0, got "${range}"`);
    const tMaj = Number(rm[1]);
    const tMin = Number(rm[2]);
    const targetCaret = `^${tMaj}.${tMin}.0`; // == range, rebuilt from parts for clarity
    const targetWide = `>=${tMaj}.${tMin}.0 <${tMaj}.${tMin + 1}.0`; // the equivalent explicit range

    const lines = src.split('\n');

    // The explanatory comment is the contiguous run of `#` lines immediately
    // above a `catalog:`/`catalogs:` header. Its version prose is the only prose
    // we touch, and even there only the tokens naming the minor the catalog
    // CURRENTLY pins — see `commentSubs` below.
    const commentLines = new Set();
    for (let i = 0; i < lines.length; i++) {
        if (blockHeader.test(lines[i])) {
            for (let j = i - 1; j >= 0 && /^\s*#/.test(lines[j]); j--) commentLines.add(j);
        }
    }

    // Which minor(s) is the catalog on right now? We rewrite ONLY those tokens in
    // the comment, keyed on the version the catalog itself declares — never "any
    // caret". An unrelated version sharing that comment block (a Node `^20.19.0`
    // engines note, say) matches no current core pin and is left alone, so the
    // safety claim holds even across a major bump: the current `^0.12.0` is
    // rewritten, a `^20.x` is not.
    const commentSubs = [];
    const seenMinor = new Set();
    forEachCatalogEntry(lines, (name, ver) => {
        if (!CORE_PACKAGES.has(name)) return;
        const vm = /(\d+)\.(\d+)/.exec(ver); // lower bound of a caret or a wide range
        if (!vm) return;
        const maj = Number(vm[1]);
        const min = Number(vm[2]);
        const key = `${maj}.${min}`;
        if ((maj === tMaj && min === tMin) || seenMinor.has(key)) return; // target, or already collected
        seenMinor.add(key);
        // Explicit range first (it contains no caret, so it can't collide with the
        // caret pass); then the bare caret. Both forms name the same pinned minor.
        commentSubs.push({
            wide: new RegExp(`>=\\s*${reEscape(key)}(?:\\.\\d+)?\\s*<\\s*${maj}\\.${min + 1}(?:\\.\\d+)?`, 'g'),
            caret: new RegExp(`\\^${reEscape(key)}(?:\\.\\d+)?`, 'g'),
        });
    });

    let inCatalog = false;
    let catalogIndent = -1;
    const pins = [];
    const comments = [];

    const out = lines.map((line, idx) => {
        // --- explanatory-comment rewrite ---------------------------------------
        if (commentLines.has(idx) && commentSubs.length) {
            let next = line;
            for (const sub of commentSubs) next = next.replace(sub.wide, targetWide).replace(sub.caret, targetCaret);
            if (next !== line) comments.push({ from: line.trim(), to: next.trim() });
            return next;
        }

        // --- catalog pin rewrite -----------------------------------------------
        if (blockHeader.test(line)) {
            inCatalog = true;
            catalogIndent = line.search(/\S/);
            return line;
        }
        if (inCatalog) {
            const indent = line.search(/\S/);
            // A non-blank, non-COMMENT line at or below the block header's indent ends
            // the block. Comments are excluded deliberately: a `# …` at column 0 is
            // valid YAML anywhere inside a mapping, and treating it as the end silently
            // dropped every entry after it — the catalogs in this org are commented, so
            // sync:core would rewrite the first few pins, report success, and leave the
            // rest on the old minor. A partially-aligned catalog is the two-copies
            // hazard the single-minor rule exists to prevent.
            if (line.trim() !== '' && !/^\s*#/.test(line) && indent <= catalogIndent && !entry.test(line)) {
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
        pins.push({ name, from: ver, to: range });
        return `${ind}${nameQ}${name}${nameQ}: ${valQ}${range}${valQ}${trailing ?? ''}`;
    });

    return { text: out.join('\n'), pins, comments };
}

/** Resolve the target minor as `^X.Y.0`, from an arg or the npm registry. */
function resolveRange(versionArg) {
    let v = versionArg;
    if (!v) {
        // Offline, a registry outage or an auth problem would otherwise surface as a
        // raw execSync stack trace — noise in a CI log, and it buries the one useful
        // instruction (pass the version explicitly).
        try {
            v = execSync('npm view @sigx/reactivity version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        } catch (err) {
            console.error(
                'sync-core: could not read the latest core version from npm ' +
                    `(${String(err.message).split('\n')[0]}).\n` +
                    'Pass the target explicitly instead: node scripts/sync-core.mjs X.Y',
            );
            process.exit(2);
        }
    }
    const m = /^v?(\d+)\.(\d+)/.exec(v);
    if (!m) {
        console.error(`sync-core: cannot parse a version from "${v}"`);
        process.exit(2);
    }
    return { range: `^${m[1]}.${m[2]}.0`, display: `${m[1]}.${m[2]}` };
}

/** CLI entry point — all the I/O and process-exit side effects live here. */
function main() {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const wsPath = join(repoRoot, 'pnpm-workspace.yaml');

    const args = process.argv.slice(2);
    const checkOnly = args.includes('--check');
    const versionArg = args.find((a) => !a.startsWith('-'));

    if (!existsSync(wsPath)) {
        console.error(`sync-core: no pnpm-workspace.yaml at ${wsPath}`);
        process.exit(2);
    }

    // Refuse to run against inline core pins. This script edits the catalog and
    // nothing else, so a repo whose core deps live in package.json has nothing for
    // the walk below to match — it would print "already aligned" and exit 0 while
    // leaving the repo on the old core. That false green is worse than no tooling:
    // core-sync.yml swallows it as success and opens no PR.
    const inline = findInlineCoreDeps(repoRoot);
    if (inline.length) {
        console.error(
            'sync-core: this repo pins core packages INLINE, outside the catalog:\n' +
                formatInlineCoreDeps(inline)
                    .map((l) => '  - ' + l)
                    .join('\n') +
                '\n\nsync:core can only rewrite catalog entries, so it cannot align this repo.' +
                '\nAdd the packages above to the `catalog:` block of pnpm-workspace.yaml and' +
                '\nreplace each specifier with "catalog:", then re-run. `pnpm verify:catalog`' +
                '\nchecks the same thing on every CI run.',
        );
        process.exit(1);
    }

    const { range, display } = resolveRange(versionArg);
    const src = readFileSync(wsPath, 'utf8');
    const { text, pins, comments } = alignCatalog(src, range);

    if (pins.length === 0 && comments.length === 0) {
        console.log(`sync-core: catalog already aligned to core ${display} (no change).`);
        process.exit(0);
    }

    console.log(`sync-core: align catalog to core ${display}:`);
    for (const c of pins) console.log(`  ${c.name}: ${c.from} -> ${c.to}`);
    for (const c of comments) console.log(`  comment: ${c.from} -> ${c.to}`);

    if (checkOnly) {
        console.error('sync-core: --check found drift (see above). Run without --check to apply.');
        process.exit(1);
    }

    writeFileSync(wsPath, text);
    console.log(`\nsync-core: wrote ${wsPath}. Next: pnpm install && pnpm build && pnpm typecheck && pnpm test`);
}

// Run the CLI only when executed directly, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
