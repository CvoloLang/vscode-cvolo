# Bundled Language Server staging

Source control does not contain Language Server binaries.

Release packaging may stage supported artifacts as:

```text
server/win-x64/cvolo-language-server.exe
server/linux-x64/cvolo-language-server
server/linux-arm64/cvolo-language-server
server/osx-x64/cvolo-language-server
server/osx-arm64/cvolo-language-server
```

Development should normally use `cvolo.server.path` or `PATH`.

VSC-0 performs no runtime download/update.

## Bundle contract

`package.json` records the bundled/expected Language Server and the compiler
compatibility line it targets under `bundledLanguageServer`:

```json
"bundledLanguageServer": {
  "version": "0.0.21-alpha.0",
  "compilerCompatibilityLine": "0.0.21",
  "toolingVersion": "0.0.21.0"
}
```

The extension's own product SemVer stays independent of these compiler-coupled
identifiers. `scripts/validate.js` enforces the recorded values.

## Staged payload status

The currently staged `server/win-x64` payload carries a `tooling.manifest.json`
recording the legacy line (`ToolingVersion 0.0.5.9`, `CompilerCompatibilityLine 0.0`,
`BuiltFromCompilerVersion 0.0.5-alpha.1`). It is **stale**: the LanguageServer has moved to
`0.0.21-alpha.0` / `compiler-line 0.0.21`, and the tooling contract is now
`tooling 0.0.21.0` (published 2026-09-29). The staged win-x64 package must be refreshed to
the `0.0.21` line before it is used in a release bundle.
