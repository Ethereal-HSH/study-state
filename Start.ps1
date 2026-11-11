param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$url = 'http://127.0.0.1:4318'

# Reuse this app when already running. Never stop another process on the port.
try {
    $client = New-Object System.Net.WebClient
    $client.Proxy = $null
    $health = $client.DownloadString("$url/api/health") | ConvertFrom-Json
    if ($health.app -eq 'study-state') {
        Write-Host "Study State is already running at $url"
        if (-not $NoBrowser) { Start-Process $url }
        exit 0
    }
} catch { } finally { if ($client) { $client.Dispose() } }

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeExecutable = $nodeCommand.Source }
else {
    $nodeExecutable = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js 22+ is required. Install Node.js, then try again.' }
}
$env:PATH = "$(Split-Path -Parent $nodeExecutable);$env:PATH"
$nextCli = Join-Path $PSScriptRoot 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $nextCli)) { throw 'Dependencies are missing. Run pnpm install --frozen-lockfile in this folder first.' }
if (-not (Test-Path -LiteralPath '.next\BUILD_ID')) {
    & $nodeExecutable $nextCli build --webpack
    if ($LASTEXITCODE -ne 0) { throw 'The application build failed.' }
}
$env:APP_ORIGIN = $url
Write-Host "Study State: $url"
Write-Host 'Keep this window open. Press Ctrl+C to stop the service.'
New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'data') -Force | Out-Null
$server = Start-Process -FilePath $nodeExecutable -ArgumentList @('node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','4318') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data\server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data\server.err') -PassThru
try {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($server.HasExited) { throw 'The server exited. Check whether port 4318 is already in use.' }
        try {
            $probe = New-Object System.Net.WebClient
            $probe.Proxy = $null
            $response = $probe.DownloadString("$url/api/health") | ConvertFrom-Json
            if ($response.app -eq 'study-state') { break }
        } catch { } finally { if ($probe) { $probe.Dispose() } }
        Start-Sleep -Milliseconds 300
    }
    if ($response.app -ne 'study-state') { throw 'The server did not become ready.' }
    if (-not $NoBrowser) { Start-Process $url }
    $server.WaitForExit()
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id }
}
