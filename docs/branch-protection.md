# Branch protection — `main` as code

GitHub branch rules live in repo *settings*, not in the repo's files, so they
drift silently between projects and nobody can review a change to them. We keep
them reproducible with
[`scripts/apply-branch-protection.mjs`](../scripts/apply-branch-protection.mjs):
one command applies the same `main` ruleset to any repo, and re-running
reconciles drift.

## Run it

Needs `gh` authenticated (`gh auth login`) with **admin** on the repo.

```sh
# baseline (PR + review + no force-push/deletion, squash-only merges):
node scripts/apply-branch-protection.mjs signalxjs/<REPO>

# also require CI to be green — pass your real check-run names:
node scripts/apply-branch-protection.mjs signalxjs/<REPO> \
  --checks "test (ubuntu-latest, 22); verify-pack; codecov/patch"

# preview without changing anything:
node scripts/apply-branch-protection.mjs signalxjs/<REPO> --dry-run
```

Including **`codecov/patch`** is what makes the test-first convention
non-optional: it fails any PR whose changed lines aren't covered (config in
[`codecov.yml`](../codecov.yml); setup in [adopting.md](adopting.md#enable-codecov-coverage-gating)).
Add it only once Codecov is reporting on the repo, or no PR will be mergeable.

It's idempotent: it finds the ruleset named **“sigx-standard: protect main”** by
name and updates it, or creates it if missing.

## What it enforces

**Repo merge settings**

- **Squash-only** — merge commits and rebase-merges are disabled, so `main` stays
  linear. This is why `AGENTS.md` says “repo rules block merge commits.”
- **Auto-merge allowed** — `gh pr merge --squash --auto` is how a PR enters
  the merge queue (AGENTS.md step 6).
- **Auto-delete head branch on merge** — keeps the branch list clean.

**Ruleset on `main`**

- **No direct pushes** — the branch is only writable through a PR.
- **Pull request required**, with:
  - **`--approvals N` approving reviews** (default **1**; pass `--approvals 0` for a
    solo/small repo where a PR + green CI is required but the author/owner merges
    without a separate human approval — GitHub blocks self-approval, and Copilot
    reviews but can't formally approve),
  - **stale approvals dismissed** when new commits are pushed,
  - **CODEOWNERS review required** when `--approvals` ≥ 1 (so `.github/CODEOWNERS` gates),
  - **review threads must be resolved** before merge.
- **No force-push** (`non_fast_forward`) and **no deletion** of `main`.
- **Merge queue** (squash, `ALLGREEN`, groups of up to 5, the same as
  `signalxjs/core`): queued PRs are tested together against the latest `main`
  and merged in order, so a merge never leaves the next PR stale.
- **Required status checks** (optional, via `--checks`): the listed checks must
  pass. They are **not strict** (the branch need not be up to date), since the
  queue re-runs them on its own ref against the latest `main`.

## Every required check must run on `merge_group`

The queue builds each group on a temporary `gh-readonly-queue/main/…` ref and
waits for every required check to report there. If a workflow that produces a
required check lacks the `merge_group:` trigger, queued PRs wait on checks
that never run until the queue times out (`signalxjs/core#336`). So:

- `ci.yml` and `bundle-size.yml` in this template trigger on `merge_group`. If
  you add a workflow whose check you require, give it the trigger too.
- Jobs that are *not* required can skip the queue run with
  `if: github.event_name != 'merge_group'` (the template's `coverage` does).
  They already ran on the PR. If you later require one, drop its guard in the
  same change.
- `codecov/patch` is reported by Codecov, not by a job. Before requiring it,
  confirm it reports on a queue ref (with `coverage` unguarded), or it will
  wedge the queue.

`bypass_actors` is intentionally empty — not even admins skip the PR flow. If you
ever need an escape hatch, add actor IDs there and re-run.

## Why required checks are opt-in

A required status check is matched by its **check-run name**, and a matrix job
expands into several (`test (ubuntu-latest, 20)`, `test (ubuntu-latest, 22)`,
`test (windows-latest, 22)`, …). If you require a name that never reports, *no
PR can ever merge*. So the script doesn't guess: it enforces PR + review by
default, and you add checks once you know the exact names.

Find them on any open PR:

```sh
gh pr checks <pr>          # lists each check-run by its exact name
```

then re-run with `--checks "<those names>"`.

> Tip: if the matrix names feel brittle, add a tiny final job to `ci.yml` that
> `needs:` all the others (a “CI passed” gate) and require just that one name.
> Until then, list the matrix names explicitly.
