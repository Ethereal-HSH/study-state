$ErrorActionPreference = 'Stop'
$client = New-Object System.Net.WebClient
$client.Proxy = $null
try { $health = $client.DownloadString('http://127.0.0.1:4318/api/health') | ConvertFrom-Json }
catch { Write-Host 'Study State is not running on port 4318.'; exit 0 }
finally { $client.Dispose() }
if ($health.app -ne 'study-state') { throw 'Port 4318 belongs to another service. Nothing was stopped.' }
$serverProcess = Get-Process -Id ([int]$health.pid) -ErrorAction Stop
if ($serverProcess.ProcessName -ne 'node') { throw 'The process is not the expected Node.js server. Nothing was stopped.' }
Stop-Process -Id $serverProcess.Id
Write-Host 'Study State stopped. Your saved data is retained.'
