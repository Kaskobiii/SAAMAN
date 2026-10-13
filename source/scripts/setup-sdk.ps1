param([string]$Destination=(Join-Path $PSScriptRoot '../external/webview2'))
$ErrorActionPreference='Stop'
$taskVersion='1.0.4258.31'
$taskHash='56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDestination=[IO.Path]::GetFullPath($Destination)
if(-not $taskDestination.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'The SDK destination must be inside this source folder.'}
New-Item -ItemType Directory -Path $taskDestination -Force|Out-Null
$taskZip=Join-Path $taskDestination 'webview2-sdk.zip'
if(-not(Test-Path -LiteralPath $taskZip)){
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$taskVersion/microsoft.web.webview2.$taskVersion.nupkg" -OutFile $taskZip
}
if((Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash -ne $taskHash){throw 'The Microsoft SDK checksum did not match the pinned package.'}
Expand-Archive -LiteralPath $taskZip -DestinationPath $taskDestination -Force
Write-Host "Microsoft WebView2 SDK $taskVersion is ready."
