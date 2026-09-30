# Bundled Language Server staging

Source control does not contain Language Server binaries. Release packaging
stages exactly one platform bundle per VSIX as:

```text
server/win-x64/cvolo-language-server.exe
server/linux-x64/cvolo-language-server
server/linux-arm64/cvolo-language-server
server/osx-x64/cvolo-language-server
server/osx-arm64/cvolo-language-server
```

Development should normally use `cvolo.server.path` or `PATH`.

The extension performs no runtime download/update.

## Provenance source of truth

The bundled Language Server identity is **not** recorded in `package.json`. It
comes from the manifest that ships inside each staged bundle:

```text
server/<rid>/bundle-manifest.json
```

That manifest records `languageServerVersion`, `languageServerCommit`,
`toolingVersion`, `toolingCommit`, `compilerCompatibilityLine`, `rid`,
`schemaVersion` and the full `files[]` inventory. The extension reads it at
activation to log provenance, and `scripts/validate.js` validates the staged
bundle against it.

## Staging

`scripts/stage-server.js` stages a bundle deterministically from the official
GitHub Release. It downloads the release archive, its manifest sidecar and
`SHA256SUMS`, verifies the archive against `SHA256SUMS`, verifies
`bundle-manifest.json` against its sidecar, validates the manifest contract, then
extracts the archive unchanged into `server/<rid>/`:

```text
node scripts/stage-server.js --lsp-version <version> --rid <rid>
```

Nothing is ever copied from a local LanguageServer build tree
(`LanguageServer/bin`, `LanguageServer/artifacts`, or a previous staging
directory). The published GitHub Release is authoritative.

## Platform mapping

One VS Code target maps to exactly one Language Server RID. The mapping lives in
`server-platform.js` and is the single source of truth for the runtime, the
staging script, the packaging workflow and validation.

```text
win32-x64    -> win-x64
linux-x64    -> linux-x64
linux-arm64  -> linux-arm64
darwin-x64   -> osx-x64
darwin-arm64 -> osx-arm64
```
