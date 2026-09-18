# Cvolo for Visual Studio Code

`Cvolo.VSCode` is the thin Visual Studio Code product/runtime shell for the standalone Cvolo Language Server. The extension registers `.cvl` files, provides lexical TextMate highlighting and editor mechanics, starts one Language Server client lifecycle at a time, and forwards language intelligence through LSP.

The extension intentionally does **not** parse or interpret Cvolo semantics. Diagnostics, completion, hover, navigation, symbols, references, rename, semantic tokens, signature help, code actions, code fixes, project discovery, and compiler interaction belong to `Cvolo.LanguageServer` / compiler tooling.

## Compatibility and execution model

The extension declares VS Code `^1.82.0` and runs as a workspace extension (`extensionKind: ["workspace"]`). In remote windows, server discovery therefore uses the platform, architecture, filesystem, `PATH`, and machine-scoped settings of the workspace extension host.

The VSCode-0 compatibility lane is Node 18.15.x, matching the runtime family implied by the VS Code 1.82 baseline. CI also runs a newer Node lane for forward compatibility.

Virtual workspaces are explicitly unsupported because the current Language Server contract requires filesystem-backed project files. VSCode-0 does not claim unrestricted untrusted-workspace safety; that requires a later review of actual server/project execution behavior.

## Language Server discovery

The server command is resolved in this order:

1. `cvolo.server.path` when explicitly configured.
2. A bundled executable at `server/<rid>/cvolo-language-server[.exe]`, if physically present.
3. `cvolo-language-server` from the workspace extension host's `PATH`.

`cvolo.server.path` is a development/advanced-user override. A non-empty value must be an absolute path, must exist, and must resolve to a file. An invalid explicit override is reported as a startup failure; it does not silently fall back to another server source.

VSCode-0 only reserves the bundled layout and RID names (`win-x64`, `linux-x64`, `linux-arm64`, `osx-x64`, `osx-arm64`). It does **not** guarantee that bundled server payloads are present yet; artifact production and VSIX inclusion belong to VSCode-1.

## LanguageClient lifecycle

The canonical LanguageClient id is `cvolo`. One serialized lifecycle gate owns initial start, manual/configuration restart, and final stop, so extension-owned lifecycle mutations cannot overlap. Deactivation raises a fence immediately; queued restart work cannot start a replacement server after shutdown begins.

The LanguageClient default connection-close restart behavior is disabled with `connectionOptions.maxRestartCount = 0`. VSCode-0 intentionally leaves crash recovery to manual/configuration restart rather than adding a second automatic recovery loop.

Use **Cvolo: Restart Language Server** (`cvolo.restartLanguageServer`) to perform a serialized stop/start replacement.

## Tracing and diagnostics

Protocol tracing uses the canonical `vscode-languageclient` setting:

```text
cvolo.trace.server = off | messages | verbose
```

The LanguageClient itself owns this setting. Changing protocol trace does not restart the Language Server, does not call extension-owned `setTrace`, and does not add process CLI arguments.

The extension writes lifecycle context to the **Cvolo Language Server** output channel. Extension-owned pre-client resolution/validation failures may show one concise error notification. Failures after `LanguageClient.start()` takes over are logged with extension context without adding an unconditional second popup.

## Development

Install the exact lockfile dependencies and run the foundation checks:

```bash
npm ci
npm run check
```

`npm run check` performs JavaScript syntax checks, static repository validation, and deterministic Node unit tests. The tests cover RID/server resolution, lifecycle serialization, deactivation fencing, failure-chain recovery, and manifest/runtime contracts without requiring a VS Code extension host.

No compiler, ANTLR, bundler, or semantic implementation dependency belongs in this repository foundation.
