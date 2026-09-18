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
