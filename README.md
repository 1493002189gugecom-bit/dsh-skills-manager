# dsh-skills-manager

A **skill center** for the DeepSeek Harness web GUI that can scan **any directory
you point it at** — Codex, Claude, another DSH install, or a plain folder of
`SKILL.md` files.

This is a fork of [`@linxin666/dsh-client-ui-skill-explorer@0.3.20`](https://github.com/zhu1090093659/dsh-web)
(BSD-3-Clause) that adds **panel-managed scan directories**. Upstream, adding a
directory such as `D:\Codex\.codex\skills` meant hand-editing `customSkillDirs`
in your profile's `cordis.patch.yml` and restarting DSH. Here you type the path
into the panel.

## What it does

- **Sidebar entry** "技能中心 / Skill Center" opens a panel with three tabs.
- **Skills tab** — every skill the plugin can see, grouped by source (system
  bundled / project `.dsh/skills` / project `.agents/skills` / custom directories
  from config / **directories you added** / user `~/.dsh/skills` / user
  `~/.agents/skills` / runtime registered). Search by name or description,
  filter by workspace, toggle a skill's model invocation (rewrites
  `disable-model-invocation` in the SKILL.md frontmatter), delete into a
  recoverable `.trash`.
- **Create tab** — write a new skill under `~/.dsh/skills` or the project root.
- **Directories tab** *(new in this fork)* — add, inspect and remove scan roots
  at runtime. Each row shows the path, whether it came from the config or the
  panel, how many skills were found, and whether the directory still exists.

## What this fork changes

| Change | Why |
|---|---|
| **Directories tab + 3 API routes** (`directories`, `add-directory`, `remove-directory`) | The feature upstream lacks: manage scan roots without editing YAML. |
| Panel-added roots persist in `$DSH_HOME/dsh-skills-manager/custom-dirs.json` | They survive a restart; the profile config is never rewritten. |
| New group `custom-added` separates panel roots from `customSkillDirs` | You can tell your own additions from hand-written config. |
| Config roots are read-only in the panel | The plugin will not rewrite your `cordis.patch.yml`; removing a config root is refused with `CONFIG_MANAGED`. |
| **Telemetry removed** | Upstream sent one heartbeat per browser per UTC day to `dsh-market.com`. This fork makes no outbound requests. |
| Own API namespace `/api/dsh-skills-manager/*` | It can never fight the original plugin for the same route paths if both end up loaded. |
| CSS class prefix `dsm_` | Same reason: the two stylesheets cannot collide. |

Everything else — the scanner, the trust fence, the frontmatter parser, the
grouping and precedence rules, the `mountOnce` guard — is upstream code, kept
as close to verbatim as possible. Every vendored file carries a header naming
its origin. See [Provenance](#provenance).

## Install

Not published to npm. Install straight from GitHub, into the profile you
actually run:

```powershell
# DSH Desktop
dsh plugin --profile desktop add git+https://github.com/1493002189gugecom-bit/dsh-skills-manager.git

# or the command-line web profile
dsh plugin --profile web add git+https://github.com/1493002189gugecom-bit/dsh-skills-manager.git
```

`web` and `desktop` are **separate configurations** (their own
`package.json`, `cordis.patch.yml` and `node_modules`); installing into one does
not touch the other. Fully quit and restart that DSH afterwards (on Desktop,
quit the tray too).

If you have the original `@linxin666/dsh-client-ui-skill-explorer` enabled in the
same profile, disable it first — the two panels do the same job and both inject a
sidebar entry.

### Updating

**Do not use `dsh plugin update`.** Git dependencies are pinned to a commit in
`pnpm-lock.yaml`, and `update` will not re-resolve it — you would keep running
the old revision while believing you upgraded. Remove and re-add instead:

```powershell
dsh plugin --profile desktop remove dsh-skills-manager
dsh plugin --profile desktop add git+https://github.com/1493002189gugecom-bit/dsh-skills-manager.git
```

### Uninstall

```powershell
dsh plugin --profile desktop remove dsh-skills-manager
```

The directory store under `$DSH_HOME/dsh-skills-manager/` is left behind; delete
it by hand if you want a clean slate.

## Use

1. Open **技能中心 / Skill Center** in the sidebar.
2. Go to **目录管理 / Directories**.
3. Paste an absolute path, e.g. `D:\Codex\.codex\skills`, and press
   **添加目录 / Add directory**.
4. Switch to **技能 / Skills** — the skills from that directory are listed under
   **面板添加的目录 / Directories added in the panel**.

The path must be absolute and must exist as a directory; the host validates both
before storing it. Adding a path never creates, moves or executes anything.

Removing an entry only forgets the path. **No skill file is ever deleted** by the
directories tab.

### Adding a Codex-style directory

Codex keeps system skills nested one level deeper
(`.system/skill-creator/SKILL.md`). The scanner reads one level only
(`<root>/<name>/SKILL.md` or `<root>/<name>.md`), matching the official DSH
provider's shallow rule, so a nested group of skills needs its own root:

| Goal | Add this |
|---|---|
| The 18 top-level Codex skills | `D:\Codex\.codex\skills` |
| The 6 bundled ones under `.system` | `D:\Codex\.codex\skills\.system` |

Skills whose frontmatter `name` is not kebab-case (lowercase letters, digits and
dashes) are skipped by the scanner — that is upstream behaviour, not a bug.

## Important boundary: listed is not loaded

This plugin manages **what the skill center shows and what it can toggle**. It
does **not** register anything with DSH's runtime skill registry, so adding a
directory here does not let the model invoke those skills.

To make the agent actually load a directory, configure the official DSH skill
provider, or place the skills under `~/.dsh/skills`. The toggle in this panel
writes the `disable-model-invocation` frontmatter field, which is the official
marker — but the directory itself still has to be one DSH loads.

## Development

```powershell
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (124 tests)
npm run build       # esbuild -> lib/
```

### Build

`scripts/build.mjs` produces both halves:

- `lib/index.js` — plain ESM, the cordis host entry.
- `lib/client.js` — a CJS body wrapped in the GUI's ModuleLoader contract
  (`window.__ModuleLoader__.load({ id, factory })`), with `react`,
  `react-dom/client` and `react/jsx-runtime` left external for the shell to
  provide, and the panel CSS resolved at build time into
  `src/client/skill-panel.css.ts` (inlined, injected once at apply time).

Upstream builds with the monorepo-private `shared/tsdown.client.ts` preset,
which is not published and cannot be imported from a standalone package. This
script emits the same artifact shape without it.

### Tests

124 tests: the upstream suite (93) plus this fork's (31).

| File | Covers |
|---|---|
| `tests/directories.spec.ts` | Store format, path validation codes, dedup/precedence, atomic writes, corrupt-store refusal, config-root protection |
| `tests/directory-routes.spec.ts` | The 3 added routes: trust fence, method check, body validation, code-to-status mapping |
| `tests/panel-directories.spec.tsx` | The Directories tab in jsdom: listing, add, empty-path refusal, remove + confirm, inline host errors |
| upstream specs | Scanner, grouping, fence, panel, contracts |

Two upstream tests assert the plugin's own identity and route set, so they were
updated for the new namespace and the three extra routes.

## Security model

Unchanged from upstream; the new routes follow the same rules.

- **Loopback trust fence**: every `/api/dsh-skills-manager/*` route requires a
  loopback socket address **and** a loopback `Host` header **and** browser
  same-origin markers. Cross-site requests get 403. When `dsh-remote-web-ui` is
  loaded, a live paired-device cookie is an additional allow path. The plugin
  adds a fence on top of the host's access control; it does not authenticate.
- **Paths are validated, then stored**: absolute, existing directory only.
  Nothing is created, moved, or executed.
- **The panel never rewrites your config.** Config roots are shown as
  read-only and removal is refused.
- **Removal is configuration-only** and touches no file on disk.
- **Write routes trust only freshly scanned paths**: a path shown by the panel
  is an identity claim, re-resolved by a fresh scan before any mutation, so a
  vanished same-name skill cannot redirect an action onto a different file.
- **Skill content is rendered as text**; no HTML injection.
- **No outbound requests**: telemetry was removed in this fork.

## Provenance

The `src/` and `tests/` trees are vendored from `zhu1090093659/dsh-web`, tag
`v0.3.20`, directory `packages/dsh-skill-explorer`, retrieved from GitHub. Every
vendored file starts with a header naming that origin and the local changes.
Files added by this fork are marked as such:

- `src/directories.ts`, `src/client/DirectoriesTab.tsx`, `src/client/styles.ts`
- `tests/directories.spec.ts`, `tests/directory-routes.spec.ts`, `tests/panel-directories.spec.tsx`
- `scripts/build.mjs`, `cordis.patch.yml`, this README

Upstream licence: BSD-3-Clause — see [LICENSE](LICENSE), which is the upstream
licence file, kept as required.