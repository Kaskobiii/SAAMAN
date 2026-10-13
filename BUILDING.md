# Building SAAMAN

## Requirements

- Windows with Visual Studio Desktop development with C++, including x86 tools.
- CMake 3.20 or newer and a supported Visual Studio generator.
- Node.js 24 LTS, including npm.
- Microsoft Edge WebView2 Runtime for running the plugin or native UI harness.
- Internet access on the first build to download npm dependencies and the
  pinned Microsoft WebView2 SDK. Its checksum is verified by the setup script.

The EuroScope SDK header/import library and pinned performance data are included.
Preserve their notices and the licenses under `source` and `source/vendor`.

## Build the DLL

Run `BUILD.cmd` from the repository root, or use PowerShell:

```powershell
& ./source/scripts/build.ps1
```

This imports bundled data, checks UI types, runs the model/adapter tests, builds
and embeds the UI, compiles the x86 DLL and runs the native state tests. The
result is `SAAMAN.dll` at the repository root. If that DLL is loaded, the build
is staged under `releases/<version>/SAAMAN.dll` instead. Unload the old plugin
before replacing it. The version in `source/version.json` drives both UI and DLL.

## Run model/adapter tests separately

```powershell
cd source/ui
npm ci --no-audit --no-fund
npm test
```

## Test the native UI

After a build, run the test harness with a new isolated output folder:

```powershell
& ./source/build/Release/saaman_host_test.exe ./source/build/host-test-data
```

It runs synthetic telemetry through the real WebView and checks operations,
pane movement, hidden updates and the separate coordination popup. It writes
screenshots and test results to that folder without loading the EuroScope SDK
or changing the installed plugin. A live EuroScope session is still needed to
check SDK integration and a real shared connection.

Keep runtime history, recordings, saved profiles and credentials out of Git.
Compiled DLLs belong in GitHub Releases; build folders and dependencies are ignored.

## Backend compatibility and user guide

From `source/ui`, run `npm run test:backend` for the pinned vatIRIS router,
or `npm run test:backend:upstream` to check current upstream main. These checks
download public source and require Internet access, but run all AMAN requests
against an isolated local server. No VATSIM login, database or controller key is needed.
See [BACKEND-COMPATIBILITY.md](docs/BACKEND-COMPATIBILITY.md).

Run `python source/scripts/build-user-guide.py` from the repository root after
editing `docs/user-guide.md`. Add `--check` to verify its HTML exports.
