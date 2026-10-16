param([ValidateSet('Release','Debug')][string]$Configuration='Release',[string]$Generator='')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskNode=(Get-Command node -ErrorAction SilentlyContinue).Source
$taskNpm=(Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if(-not $taskNode -or -not $taskNpm){throw 'Install Node.js LTS for development, then reopen this terminal.'}
$taskCmake=(Get-Command cmake -ErrorAction SilentlyContinue).Source
$taskVsWhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if(Test-Path -LiteralPath $taskVsWhere){
    $taskVS=& $taskVsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json|ConvertFrom-Json
    if(-not $taskCmake -and $taskVS){$taskCmake=Join-Path $taskVS.installationPath 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'}
    if(-not $Generator -and $taskVS){$taskMajor=([Version]$taskVS.installationVersion).Major;$Generator=if($taskMajor -eq 18){'Visual Studio 18 2026'}else{'Visual Studio 17 2022'}}
}
if(-not $taskCmake -or -not(Test-Path -LiteralPath $taskCmake)){throw 'Install CMake and Visual Studio Desktop development with C++ (x86 support).'}
if(-not $Generator){$Generator='Visual Studio 17 2022'}
& $taskNode (Join-Path $PSScriptRoot 'import-performance.mjs');if($LASTEXITCODE){throw 'Performance data import failed'}
& $taskNode (Join-Path $PSScriptRoot 'import-openap.mjs');if($LASTEXITCODE){throw 'OpenAP data import failed'}
& $taskNode (Join-Path $PSScriptRoot 'check-sdk-input.mjs');if($LASTEXITCODE){throw 'SDK input script check failed'}
Push-Location (Join-Path $taskRoot 'ui')
try{
    if(-not(Test-Path 'node_modules')){& $taskNpm ci --no-audit --no-fund;if($LASTEXITCODE){throw 'Dependency installation failed'}}
    & $taskNode node_modules/vue-tsc/bin/vue-tsc.js --noEmit;if($LASTEXITCODE){throw 'UI type check failed'}
    & $taskNode tests/run-maestro-tests.mjs;if($LASTEXITCODE){throw 'Timing tests failed'}
    & $taskNode (Join-Path $PSScriptRoot 'build-ui.mjs');if($LASTEXITCODE){throw 'UI build failed'}
}finally{Pop-Location}
& $taskNode (Join-Path $PSScriptRoot 'embed-assets.mjs');if($LASTEXITCODE){throw 'Asset embedding failed'}
$taskSdk=Join-Path $taskRoot 'external/webview2'
if(-not(Test-Path (Join-Path $taskSdk 'build/native/include/WebView2.h'))){& (Join-Path $PSScriptRoot 'setup-sdk.ps1')}
$taskBuild=Join-Path $taskRoot 'build'
& $taskCmake -S $taskRoot -B $taskBuild -G $Generator -A Win32 "-DWEBVIEW2_SDK=$taskSdk";if($LASTEXITCODE){throw 'Native configuration failed'}
& $taskCmake --build $taskBuild --config $Configuration;if($LASTEXITCODE){throw 'Native build failed'}
& (Join-Path $taskBuild "$Configuration/saaman_context_test.exe") (Join-Path $taskBuild 'context-test-data');if($LASTEXITCODE){throw 'Native state tests failed'}
$taskOutput=[IO.Path]::GetFullPath((Join-Path $taskRoot '..'))
try{Copy-Item -LiteralPath (Join-Path $taskBuild "$Configuration/SAAMAN.dll") -Destination (Join-Path $taskOutput 'SAAMAN.dll') -Force}
catch{
    $taskVersion=(Get-Content -Raw (Join-Path $taskRoot 'version.json')|ConvertFrom-Json).version
    if($taskVersion -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid release version'}
    $taskOutput=Join-Path $taskOutput "releases/$taskVersion"
    New-Item -ItemType Directory -Path $taskOutput -Force|Out-Null
    Copy-Item -LiteralPath (Join-Path $taskBuild "$Configuration/SAAMAN.dll") -Destination (Join-Path $taskOutput 'SAAMAN.dll') -Force
    Write-Host 'The installed DLL is loaded; the new build was saved separately.'
}
Write-Host "Built $taskOutput/SAAMAN.dll. Unload the old DLL before loading this build."
