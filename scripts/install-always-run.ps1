# Installs always-run for DMS + Cloudflare Tunnel at Windows logon.
$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
$WatchScript = Join-Path $PSScriptRoot 'always-run.ps1'
$WatchTaskName = 'AE-DMS-AlwaysRun-Watch'
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$StartupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$ShortcutPath = Join-Path $StartupDir 'AE-DMS-AlwaysRun.lnk'
$RunValue = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}"' -f $PowerShell, $WatchScript

if (-not (Test-Path $WatchScript)) {
  throw "Missing $WatchScript"
}

New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'AE-DMS-AlwaysRun' -Value $RunValue -Type String
Write-Output 'HKCU_RUN=AE-DMS-AlwaysRun'

New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $PowerShell
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $WatchScript
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 7
$shortcut.Description = 'Always run A&E DMS and Cloudflare Tunnel'
$shortcut.Save()
Write-Output ("STARTUP_SHORTCUT=" + $ShortcutPath)

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$startBoundary = (Get-Date).AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ss')
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$($env:USERDOMAIN)\$($env:USERNAME)</Author>
    <Description>Always run A&amp;E DMS and Cloudflare Tunnel for the shared login page.</Description>
    <URI>\$WatchTaskName</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$($env:USERDOMAIN)\$($env:USERNAME)</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$sid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$PowerShell</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$WatchScript"</Arguments>
      <WorkingDirectory>$Root</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$xmlPath = Join-Path $env:TEMP 'ae-dms-always-run-watch.xml'
Set-Content -Path $xmlPath -Value $taskXml -Encoding Unicode
Unregister-ScheduledTask -TaskName $WatchTaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $WatchTaskName -Xml (Get-Content $xmlPath -Raw) -Force | Out-Null
Write-Output ("TASK=" + $WatchTaskName)

$already = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'always-run\.ps1' }
if (-not $already) {
  Start-ScheduledTask -TaskName $WatchTaskName
  Start-Sleep -Seconds 2
  $already = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'always-run\.ps1' }
}
if (-not $already) {
  Start-Process -FilePath $PowerShell -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $WatchScript
  ) -WorkingDirectory $Root -WindowStyle Hidden
  Write-Output 'WATCHDOG_STARTED=now'
} else {
  Write-Output 'WATCHDOG_RUNNING=1'
}

Write-Output 'Always-run is installed. Cloudflare Tunnel starts with Windows logon and stays up.'
