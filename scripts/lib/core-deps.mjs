/**
 * core-deps.mjs — the shared half of the catalog-sync tooling.
 *
 * `sync-core.mjs` and `check-catalog.mjs` both need to know which packages are
 * "core" and how to find core deps declared outside the catalog. They used to
 * carry their own copy of each, and the copies drifted: core shipped
 * `@sigx/serialize`, `@sigx/cloudflare`, `@sigx/vercel` and `@sigx/netlify`
 * while both lists still named ten packages, so a repo pinning any of them got
 * neither the rewrite nor the guard. One copy, here.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The packages published from signalxjs/core. Only these are rewritten by
 * `sync:core` and policed by `verify:catalog`.
 *
 * KEEP IN SYNC with `corePackages` in core's `docs/ecosystem.json` — core's CI
 * (`pnpm verify:ecosystem`) fails when a newly published package is missing
 * there, and that entry is the signal to update this list too. Also mirrored by
 * `SIGX_CORE_PACKAGES` in `@sigx/vite`.
 */
export const CORE_PACKAGES = new Set([
    'sigx',
    '@sigx/serialize',
    '@sigx/reactivity',
    '@sigx/runtime-core',
    '@sigx/runtime-dom',
    '@sigx/server-renderer',
    '@sigx/ssr-islands',
    '@sigx/resume',
    '@sigx/cache',
    '@sigx/server',
    '@sigx/vite',
    '@sigx/cloudflare',
    '@sigx/vercel',
    '@sigx/netlify',
]);

/** The dependency sections a core dep can hide in. */
export const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Where workspace packages live, across the repo shapes in this org. */
const WORKSPACE_DIRS = ['packages', 'app', 'apps', 'examples'];

/**
 * Every core dep in the repo that is declared with a literal version instead of
 * `"catalog:"` — the drift both tools care about.
 *
 * `verify:catalog` fails on these because the catalog is meant to be the one
 * source of truth. `sync:core` fails on these because it can only rewrite
 * catalog entries: a repo whose core deps are all inline has nothing for the
 * walk to match, and reporting "already aligned" there is a false green that
 * leaves the repo on the old core with no signal at all.
 *
 * @param {string} repoRoot
 * @returns {{ pkg: string, field: string, dep: string, spec: string }[]}
 */
export function findInlineCoreDeps(repoRoot) {
    const found = [];
    for (const base of WORKSPACE_DIRS) {
        const dir = join(repoRoot, base);
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (!statSync(path).isDirectory()) continue;
            const manifest = join(path, 'package.json');
            if (!existsSync(manifest)) continue;
            const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
            for (const field of DEP_FIELDS) {
                for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
                    if (CORE_PACKAGES.has(dep) && spec !== 'catalog:') {
                        found.push({ pkg: pkg.name ?? `${base}/${entry}`, field, dep, spec });
                    }
                }
            }
        }
    }
    return found;
}

/** Render `findInlineCoreDeps` output as bare report lines; callers add their own bullet. */
export function formatInlineCoreDeps(hits) {
    return hits.map((h) => `${h.pkg} ${h.field}["${h.dep}"] = "${h.spec}" (must be "catalog:")`);
}
