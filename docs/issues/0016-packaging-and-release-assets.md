# 0016 Packaging And Release Assets

Parent: `docs/plan.md`

What to build: Package the plugin and picker for release so published npm installs do not require a Rust/Tauri toolchain and CI validates plugin tests, typecheck, picker build, packaging, and release asset behavior.

Acceptance criteria:
- Package platform picker binaries or document and implement release asset download path.
- npm install for published builds does not require Rust/Tauri toolchain.
- CI runs plugin tests, typecheck, picker build, and packaging checks.
- Tagged release workflow publishes the plugin and platform picker assets.
- README documents install, configuration, setup, privacy, and troubleshooting.
- Clean install test from packed tarball succeeds.
- Picker binary launch smoke test succeeds.

Blocked by: 0014, 0015
