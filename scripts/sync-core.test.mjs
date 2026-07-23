import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignCatalog } from './sync-core.mjs';

// The comment formats below are copied verbatim from real consumer repos
// (i18n/pulse, terminal, router, store, use, monaco-editor) — the exact prose
// `sync:core` used to leave stale on every core bump, which is what turned clean
// catalog bumps AMBER when Copilot flagged them (#41).

test('bumps the catalog pins AND the explanatory comment (both token forms)', () => {
    // i18n / pulse / monaco format: cites both `^X.Y.0` and `>=X.Y.0 <X.(Y+1).0`.
    const src = [
        'packages:',
        '  - packages/*',
        '',
        '# Single source of truth for the SignalX core version this repo builds against.',
        '# `^0.12.0` == `>=0.12.0 <0.13.0` (ONE minor).',
        "# @sigx/reactivity keeps reactive state in module-local variables — bump this",
        '# one block to move the whole repo to a new core minor.',
        'catalog:',
        '  "@sigx/reactivity": ^0.12.0',
        '  "@sigx/runtime-core": ^0.12.0',
        '  sigx: ^0.12.0',
        '',
    ].join('\n');

    const { text, pins, comments } = alignCatalog(src, '^0.13.0');

    // Pins moved.
    assert.equal(pins.length, 3);
    assert.match(text, /"@sigx\/reactivity": \^0\.13\.0/);
    assert.match(text, /sigx: \^0\.13\.0/);

    // Comment moved — the whole point of this fix.
    assert.ok(comments.length >= 1, 'comment change should be reported');
    assert.match(text, /`\^0\.13\.0` == `>=0\.13\.0 <0\.14\.0` \(ONE minor\)\./);

    // And nothing in the comment still cites the old minor.
    const commentBlock = text.split('\n').filter((l) => l.trimStart().startsWith('#')).join('\n');
    assert.doesNotMatch(commentBlock, /0\.12/, 'no stale 0.12 token may survive in the comment');
});

test('bumps a terminal-style single-caret comment', () => {
    const src = [
        'packages:',
        '  - packages/*',
        '',
        '# Single source of truth for the SignalX core version. Every package references',
        '# these as "catalog:", which pnpm rewrites to the range below on pack/publish.',
        '# Keep core single-minor (^0.12.0) — two @sigx/reactivity copies break reactivity.',
        'catalog:',
        "  '@sigx/reactivity': ^0.12.0",
        "  '@sigx/vite': ^0.12.0",
        '',
    ].join('\n');

    const { text } = alignCatalog(src, '^0.13.0');
    assert.match(text, /Keep core single-minor \(\^0\.13\.0\)/);
    // Single-quoted pins preserved as single-quoted.
    assert.match(text, /'@sigx\/reactivity': \^0\.13\.0/);
    assert.doesNotMatch(text, /0\.12/);
});

test('bumps a router-style backtick comment with an explicit range', () => {
    const src = [
        'packages:',
        '  - packages/*',
        '',
        '# Single source of truth for the SignalX core version the router builds against.',
        '# `^0.12.0` == `>=0.12.0 <0.13.0` (ONE minor). @sigx/reactivity keeps reactive',
        '# state in module-local variables, so two physical copies break reactivity.',
        'catalog:',
        '  "@sigx/reactivity": ^0.12.0',
        '  sigx: ^0.12.0',
    ].join('\n');

    const { text } = alignCatalog(src, '^0.13.0');
    assert.match(text, /`\^0\.13\.0` == `>=0\.13\.0 <0\.14\.0`/);
    assert.doesNotMatch(text.split('\n').filter((l) => l.trimStart().startsWith('#')).join('\n'), /0\.12/);
});

test('leaves sibling-ecosystem catalog entries untouched', () => {
    const src = [
        '# Keep core single-minor (^0.12.0).',
        'catalog:',
        '  "@sigx/reactivity": ^0.12.0',
        '  "@sigx/router": ^2.4.0',
        '  sigx: ^0.12.0',
    ].join('\n');

    const { text, pins } = alignCatalog(src, '^0.13.0');
    assert.match(text, /"@sigx\/router": \^2\.4\.0/, 'sibling pin must not move');
    assert.ok(pins.every((p) => p.name !== '@sigx/router'));
});

test('does not touch a version-shaped token outside the adjacent comment block', () => {
    // A comment that is NOT the run immediately above `catalog:` (there is a blank
    // line and the `packages:` mapping between them) must be left alone, even
    // though it contains caret/range tokens — e.g. a Node engines note.
    const src = [
        '# node engines: ^20.19.0 || >=22.12.0 <23.0.0 — unrelated to the core pin',
        '',
        'packages:',
        '  - packages/*',
        '',
        '# Keep core single-minor (^0.12.0).',
        'catalog:',
        '  "@sigx/reactivity": ^0.12.0',
    ].join('\n');

    const { text } = alignCatalog(src, '^0.13.0');
    assert.match(text, /# node engines: \^20\.19\.0 \|\| >=22\.12\.0 <23\.0\.0/, 'far-away comment untouched');
    assert.match(text, /Keep core single-minor \(\^0\.13\.0\)/, 'adjacent comment updated');
});

test('is idempotent — a second run makes no further change', () => {
    const src = [
        '# `^0.12.0` == `>=0.12.0 <0.13.0` (ONE minor).',
        'catalog:',
        '  "@sigx/reactivity": ^0.12.0',
        '  sigx: ^0.12.0',
    ].join('\n');

    const first = alignCatalog(src, '^0.13.0');
    const second = alignCatalog(first.text, '^0.13.0');
    assert.equal(second.pins.length, 0);
    assert.equal(second.comments.length, 0);
    assert.equal(second.text, first.text);
});

test('an already-aligned file with a stale comment still gets the comment fixed', () => {
    // Pins current, comment stale — the drift `--check` should now catch, and a
    // plain run should fix.
    const src = [
        '# Keep core single-minor (^0.12.0).',
        'catalog:',
        '  "@sigx/reactivity": ^0.13.0',
        '  sigx: ^0.13.0',
    ].join('\n');

    const { text, pins, comments } = alignCatalog(src, '^0.13.0');
    assert.equal(pins.length, 0, 'no pin change');
    assert.ok(comments.length >= 1, 'the stale comment is still reported as a change');
    assert.match(text, /Keep core single-minor \(\^0\.13\.0\)/);
});

test('handles the minor rollover in the explicit range (0.13 -> <0.14.0)', () => {
    const src = ['# `^0.13.0` == `>=0.13.0 <0.14.0`.', 'catalog:', '  sigx: ^0.13.0'].join('\n');
    const { text } = alignCatalog(src, '^0.14.0');
    assert.match(text, /`\^0\.14\.0` == `>=0\.14\.0 <0\.15\.0`/);
});

test('rejects a range that is not a single-minor caret', () => {
    assert.throws(() => alignCatalog('catalog:\n  sigx: ^0.13.0', '>=0.13.0 <0.14.0'), /single-minor caret/);
});
