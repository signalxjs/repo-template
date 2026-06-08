# Adopting the sigx standard in a repo

Two paths: a **new repo** (use the GitHub template) or an **existing repo**
(copy the files in). Both end with the same one-time branch-protection step.

---

## New repo — “Use this template”

1. On <https://github.com/signalxjs/standard>, click **“Use this template” →
   “Create a new repository”**. Name it, owner `signalxjs`.
2. Clone it into the standard layout (note the `/main` folder):
   ```sh
   git clone https://github.com/signalxjs/<REPO>.git <REPO>/main
   cd <REPO>/main
   ```
3. Run the **customization checklist** below.
4. Lock down `main` (see [branch-protection.md](branch-protection.md)):
   ```sh
   node scripts/apply-branch-protection.mjs signalxjs/<REPO>
   ```

---

## Existing repo — copy the files in

Copy these from this template into the repo (keep the **verbatim** ones byte-for-byte):

| File / dir | Notes |
|---|---|
| `scripts/worktree.mjs` | **verbatim** |
| `scripts/apply-branch-protection.mjs` | **verbatim** |
| `CLAUDE.md` | **verbatim** |
| `AGENTS.md` | template — edit the repo-specific sections |
| `.github/workflows/*` | copy what applies (see “trimming” below) |
| `.github/` (CODEOWNERS, dependabot, templates, SUPPORT) | edit owners + package lists |
| `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | edit repo name |
| `.npmrc`, `.gitignore`, `.size-limit.json` | edit scope/paths |

Then add to the repo’s `package.json` scripts:

```json
{
  "scripts": {
    "wt": "node scripts/worktree.mjs",
    "branch-protection": "node scripts/apply-branch-protection.mjs"
  }
}
```

Re-clone into the `<repo>/main` layout if it isn’t already (the worktree helper
requires the primary checkout to live in a folder named `main`).

---

## Customization checklist

Search the repo for the two markers and resolve each:

```sh
# every placeholder that must become the repo name:
git grep -n "<REPO>"
# every spot that needs a per-repo decision:
git grep -n "TODO(sigx-standard)"
```

PowerShell find-and-replace for the repo name (run from the repo root):

```powershell
Get-ChildItem -Recurse -File -Include *.md,*.yml,*.json |
  ForEach-Object {
    (Get-Content $_ -Raw) -replace '<REPO>', 'core' | Set-Content $_ -NoNewline
  }
```

Then, file by file:

- [ ] **`AGENTS.md`** — rewrite the intro paragraph (what this repo is), the
      “Build, Test, Lint” commands, and the “Packages” list. Single-package
      repo? Drop the workspace/`--filter` bits and the “Packages” section.
- [ ] **`.github/CODEOWNERS`** — set the real owner(s) (default is `@andtii`).
- [ ] **`.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml`** —
      fill the package dropdowns, or delete them for a single package.
- [ ] **`.size-limit.json`** — set real dist paths and limits, or delete the
      file and `bundle-size.yml` if you don’t ship a bundle.
- [ ] **`SECURITY.md`** — set the supported-versions line.
- [ ] **`package.json`** — `name`, `description`, `repository`, plus `lint` /
      `typecheck` / `build` / `test` / `size` scripts that `AGENTS.md` and CI call.

### Trimming workflows per repo

- `ci.yml` — keep always. Drop the `coverage` job if you don’t use Codecov (else
  set the `CODECOV_TOKEN` secret). Drop `verify-pack` if you don’t publish.
- `bundle-size.yml` — keep only if you ship a size-limited bundle.
- `release.yml` — keep only if you publish to npm; needs `scripts/publish.js` +
  trusted publishing configured on npmjs.com. See its header comment.
- `release-drafter.yml`, `dependabot-automerge.yml` — keep for any repo.

---

## Verify it works

```sh
pnpm install
pnpm wt new smoke-test        # creates <repo>/branches/smoke-test
pnpm wt list                  # main is flagged
pnpm wt rm smoke-test         # cleans up
node scripts/apply-branch-protection.mjs signalxjs/<REPO> --dry-run
```

Open a throwaway PR and confirm CI runs and `main` rejects a direct push.
