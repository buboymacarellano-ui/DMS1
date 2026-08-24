# Keeps the DMS app and Cloudflare Tunnel running.
# One login URL is shared by every access level on the login page.
$ErrorActionPreference = 'Continue'

$mutex = New-Object System.Threading.Mutex($false, 'Global\AE-DMS-AlwaysRun')
if (-not $mutex.WaitOne(0)) {
  exit 0
}

$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root 'logs'
$DataDir = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$UrlFile = Join-Path $DataDir 'public-url.txt'
$WatchLog = Join-Path $LogDir 'always-run.log'
$CfLog = Join-Path $LogDir 'cloudflared.log'
$TokenFile = Join-Path $DataDir 'cloudflare-tunnel.token'
$Node = 'C:\Program Files\nodejs\node.exe'
$AppJs = Join-Path $Root 'app.js'
$CloudflaredX86 = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$Cloudflared64 = 'C:\Program Files\cloudflared\cloudflared.exe'
$Cloudflared = if (Test-Path $CloudflaredX86) { $CloudflaredX86 } elseif (Test-Path $Cloudflared64) { $Cloudflared64 } else { '' }

function Write-WatchLog {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $WatchLog -Value $line -Encoding UTF8
}

function Test-LocalPort {
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $Port)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-Cloudflared {
  $procs = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue
  return [bool]$procs
}

function Ensure-App {
  if (Test-LocalPort -Port 3000) { return }
  if (-not (Test-Path $Node)) {
    Write-WatchLog "node.exe not found at $Node"
    return
  }
  if (-not (Test-Path $AppJs)) {
    Write-WatchLog "app.js not found at $AppJs"
    return
  }
  Write-WatchLog 'Starting DMS app on port 3000'
  Start-Process -FilePath $Node -ArgumentList @('app.js') -WorkingDirectory $Root -WindowStyle Hidden
}

function Ensure-Tunnel {
  if (Test-Cloudflared) { return }
  if (-not $Cloudflared) {
    Write-WatchLog 'cloudflared.exe not found'
    return
  }

  Write-WatchLog 'Starting Cloudflare tunnel to http://localhost:3000'

  $token = ''
  if (Test-Path $TokenFile) {
    $token = (Get-Content -Path $TokenFile -Raw -ErrorAction SilentlyContinue).Trim()
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
}

function Update-PublicUrl {
  $loginUrl = ''
  if (Test-Path $CfLog) {
    $text = Get-Content -Path $CfLog -Raw -ErrorAction SilentlyContinue
    $matchesFound = [regex]::Matches([string]$text, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($matchesFound.Count -gt 0) {
      $hostUrl = $matchesFound[$matchesFound.Count - 1].Value.TrimEnd('/')
      $loginUrl = "$hostUrl/auth/login"
    }
  }

  if (-not $loginUrl) { return }

  $previous = ''
  if (Test-Path $UrlFile) {
    $previous = (Get-Content -Path $UrlFile -Raw -ErrorAction SilentlyContinue).Trim()
  }
  if ($previous -ne $loginUrl) {
    Set-Content -Path $UrlFile -Value $loginUrl -Encoding UTF8
    Write-WatchLog "Public login URL: $loginUrl"
  }
}

Write-WatchLog 'Always-run watchdog started'
try {
  while ($true) {
    try {
      Ensure-App
      Start-Sleep -Seconds 2
      Ensure-Tunnel
      Start-Sleep -Seconds 2
      Update-PublicUrl
    } catch {
      Write-WatchLog ("Watchdog error: " + $_.Exception.Message)
    }
    Start-Sleep -Seconds 15
  }
} finally {
  $mutex.ReleaseMutex() | Out-Null
}
