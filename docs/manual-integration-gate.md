# Manual OpenCode Integration Gate

Status: not run in this checkout.

This is a hard release gate. Run it from the exact source commit intended for
release against a local OpenCode TUI and OpenCode Desktop scratch project.
Record that commit's full 40-character SHA below. After every check passes,
commit only this evidence file on a dedicated branch based on the tested
commit. Open a pull request and merge it through the protected `main` workflow;
do not push the evidence commit directly to `main`. Confirm that the resulting
`main` commit differs from the tested commit only by this file, then wait for
the CI push run for that exact merged SHA to complete successfully before
creating and pushing the release tag at the merged commit.
CI proves that the recorded source commit is either the tagged commit itself
or its ancestor and that the only intervening file change is this document.
Automated tests cover package installation, a real OpenCode child dispatch,
native picker RPC, batching, setup, and hook contracts; only the two real
surfaces can prove interactive dispatch and history behavior.

Before the live checks, run:

```sh
bun install --frozen-lockfile
bun install --cwd picker --frozen-lockfile
bun run test
bun run typecheck
bun run test:package
bun run test:opencode
bun run test:picker:rendered
bun run test:picker-ready
bun run test:gui:auto
bun run test:gui
bun run release:manual-candidate
bun run release:manual-candidate:test
bun run release:manual-candidate:test:tui
```

Run `release:manual-candidate` after the generic tests so no later build can
silently replace the picker being retained. The command requires a clean
source candidate equal to `origin/main`, builds the plugin and current host
picker, and retains one local-host npm tarball under the git-ignored
`.manual-release/` directory. It prints the exact commit SHA, tarball basename
and SHA-512 SRI, and picker path and SHA-256 needed below. The two `:test`
commands run that retained tarball through the same installed-package native
OpenCode integration; they do not repack it. The automated retained-tarball
integration currently requires Linux/X11. Run this entire gate on a supported
Linux host so the candidate prepared there is the same one subsequently tested
in both live surfaces.

Create one genuinely empty temporary scratch project and install the retained
tarball into it through OpenCode's supported package installer:

```sh
manual_scratch="$(mktemp -d -t opencode-model-dispatch-release-XXXXXX)"
bun run release:manual-candidate:install -- --project "$manual_scratch"
```

The install helper verifies the recorded commit and both hashes again, starts
an isolated loopback-only npm registry, asks the local `opencode` executable to
install the exact `opencode-model-dispatch@<version>` package into the scratch
project, confirms that registry served the retained tarball, and then stops
the registry. Provider resolution during the live checks therefore uses the
operator's normal OpenCode configuration rather than a registry override.

Run the TUI from that directory:

```sh
cd "$manual_scratch"
opencode
```

After the TUI checks, fully quit it. Open the same directory through OpenCode
Desktop's normal **Open project** action and complete the Desktop checks. Do
not run the install helper again, change branches, rebuild, repack, or replace
anything under `.manual-release/` between the two surfaces. Record the scratch
path below as `<temp>/opencode-model-dispatch-release-XXXXXX`, never as its
real local path.

To use another retained directory, choose a repository-relative path already
ignored by Git and pass the same option to every helper invocation:

```sh
bun run release:manual-candidate -- --output .manual-release/custom
bun run release:manual-candidate:test -- --output .manual-release/custom
bun run release:manual-candidate:test:tui -- --output .manual-release/custom
bun run release:manual-candidate:install -- \
  --output .manual-release/custom \
  --project "$manual_scratch"
```

## Checklist

- [ ] `package.json` has a non-zero version and `v<version>` is the intended release tag.
- [ ] The tested source commit's full 40-character SHA and npm tarball are recorded below.
- [ ] `bun run test:package` passes from a clean checkout.
- [ ] On Linux, `bun run release:manual-candidate:test` installs the retained npm tarball and completes a real OpenCode task through its bundled native picker.
- [ ] `bun run test:gui` visibly opens the native picker and returns the chosen models.
- [ ] On Linux, `bun run test:gui:auto` submits the real Tauri window under X11/Xvfb.
- [ ] `bun run test:picker:rendered` passes its computed-theme, responsive-layout, icon-absence, and keyboard assertions in a local browser.
- [ ] Keyboard-only model search, arrow selection, Enter, Escape, and native-window close behavior work.
- [ ] Local OpenCode starts with the plugin installed in a scratch project (TUI).
- [ ] OpenCode Desktop opens the same scratch project with the plugin loaded.
- [ ] First-run setup opens at plugin load.
- [ ] Dispatch remains disabled if setup is cancelled and snoozed.
- [ ] Enabling dispatch works.
- [ ] Global/project scope persists, switching to global clears a project override, reset works, and the `.gitignore` choice reflects disk state.
- [ ] One built-in `task` in TUI opens the picker and selection overrides the model.
- [ ] One built-in `task` in Desktop opens the picker and selection overrides the model.
- [ ] Multiple parallel `task` calls batch into one picker.
- [ ] Apply-to-all and per-row selections both work.
- [ ] Child sessions show original agent names in TUI/Desktop history.
- [ ] Technical picker failure falls back to built-in task default/current model with warning.
- [ ] Explicit cancel starts no subagents; native-window close behaves the same way.
- [ ] Child session messages and task metadata record the selected model, including subsequent child turns.
- [ ] Auto/default effort works in both TUI and Desktop without forcing an explicit effort override.
- [ ] An explicit provider-advertised effort can be selected in both TUI and Desktop and reaches the child request.
- [ ] Child history and task metadata preserve the explicit effort, including subsequent child turns.
- [ ] Every hard gate and manual check above passed; no failed item is waived by documentation alone.

## Evidence

Use a public operator handle without spaces, record only the tarball filename
and repository-relative picker path, and write the scratch path as
`<temp>/name` rather than a real home or client path. Replace every placeholder
and set `Status: passed.` only after every checklist item
passes. Obtain the tested source value with `git rev-parse HEAD`; do not use an
abbreviated SHA. Once this document records the result, do not change any other
file on the evidence branch. If `main` changes before the evidence pull request
merges, rerun the gate from the new intended source instead of merging unrelated
changes between the tested source and release tag.

- Date: not recorded
- Operator: not recorded
- Commit SHA: not recorded
- OpenCode version: not recorded
- Plugin package or tarball: not recorded
- npm tarball SHA-512: not recorded
- Picker asset path: not recorded
- Picker SHA-256: not recorded
- Scratch project path: not recorded
- TUI platform: not recorded
- Desktop platform: not recorded
- TUI result: not run
- Desktop result: not run

## Release Decision

Release is blocked until every checklist item is checked, every evidence field
is complete, and both surface results are `passed`. A failed hard gate requires
a fix and a fresh run from the new source commit. CI rejects stale evidence,
non-ancestor SHAs, abbreviated SHAs, and evidence commits that also change
anything outside this file. The protected pull request and exact merged-SHA CI
must both pass. The publish workflow separately and automatically gates npm
publication, binary checksums, macOS signing/notarization, and Windows signing;
those are not manual attestations. Repository security settings are a separate
fail-closed local pre-tag gate because no tagged repository code may receive an
administration credential.
