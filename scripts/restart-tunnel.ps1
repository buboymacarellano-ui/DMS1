# Recycles only the Cloudflare tunnel. Does not reinstall the always-run task.
$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root 'logs'
$DataDir = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$CfLog = Join-Path $LogDir 'cloudflared.log'
$TokenFile = Join-Path $DataDir 'cloudflare-tunnel.token'
$CloudflaredX86 = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$Cloudflared64 = 'C:\Program Files\cloudflared\cloudflared.exe'
$Cloudflared = if (Test-Path $CloudflaredX86) { $CloudflaredX86 } elseif (Test-Path $Cloudflared64) { $Cloudflared64 } else { '' }

if (-not $Cloudflared) {
  Write-Output 'CLOUDFLARED_MISSING=1'
  exit 1
}

cmd /c 'taskkill /F /IM cloudflared.exe' | Out-Null
Start-Sleep -Seconds 1

if ((Test-Path $CfLog) -and ((Get-Item $CfLog).Length -gt 5MB)) {
  Move-Item -Path $CfLog -Destination ($CfLog + '.old') -Force
}

$token = ''
if (Test-Path $TokenFile) {
  $token = (Get-Content -Path $TokenFile -Raw).Trim()
}

if ($token) {
  Start-Process -FilePath $Cloudflared -ArgumentList @(
    'tunnel', '--no-autoupdate', 'run', '--token', $token, '--logfile', $CfLog
  ) -WorkingDirectory $Root -WindowStyle Hidden
} else {
  Start-Process -FilePath $Cloudflared -ArgumentList @(
    'tunnel', '--no-autoupdate', '--url', 'http://localhost:3000', '--logfile', $CfLog
  ) -WorkingDirectory $Root -WindowStyle Hidden
}

Write-Output 'TUNNEL_RESTARTED=1'
exit 0
