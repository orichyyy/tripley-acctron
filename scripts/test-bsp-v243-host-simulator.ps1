param(
  [string]$HostdExe = "E:\code\rust\tripley-native\target\i686-pc-windows-msvc\debug\tripley-native-hostd.exe",
  [string]$NativeDist = "E:\code\front-end\tripley-kit\libs\native\dist\index.js",
  [int]$HostdPort = 39013,
  [string]$SimulatorHost = "127.0.0.1",
  [int]$SimulatorPort = 12008,
  [string]$AtmId = "00000",
  [string]$VersionDate = "20260723",
  [string]$BusinessDate = "01150724",
  [string]$SystemDate = "01150724",
  [string]$DeviceStatus = "000000030000",
  [string]$ServiceStatus = "1",
  [string]$AtmMode = "1",
  [string]$DepositMode = "6",
  [string]$OexSequence = "00000175",
  [string]$WithdrawalSequence = "00000176"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $HostdExe)) {
  throw "tripley-native-hostd not found: $HostdExe"
}
if (-not (Test-Path -LiteralPath $NativeDist)) {
  throw "@tripley-kit/native dist not found: $NativeDist"
}

$probe = [System.Net.Sockets.TcpClient]::new()
try {
  $connect = $probe.ConnectAsync($SimulatorHost, $SimulatorPort)
  if (-not $connect.Wait(1500) -or -not $probe.Connected) {
    throw "Start tripley-host-simulator and its BSP listener on ${SimulatorHost}:$SimulatorPort."
  }
} finally {
  $probe.Dispose()
}

$hostd = Start-Process -FilePath $HostdExe -ArgumentList @(
  "--transport", "websocket",
  "--addr", "127.0.0.1:$HostdPort",
  "--services", "runtime,tcp",
  "--dev-permissive"
) -WindowStyle Hidden -PassThru

$previous = @{
  BSP_V243_SIMULATOR_SMOKE = $env:BSP_V243_SIMULATOR_SMOKE
  BSP_V243_HOSTD_PORT = $env:BSP_V243_HOSTD_PORT
  BSP_V243_SIMULATOR_HOST = $env:BSP_V243_SIMULATOR_HOST
  BSP_V243_SIMULATOR_PORT = $env:BSP_V243_SIMULATOR_PORT
  BSP_V243_ATM_ID = $env:BSP_V243_ATM_ID
  BSP_V243_VERSION_DATE = $env:BSP_V243_VERSION_DATE
  BSP_V243_BUSINESS_DATE = $env:BSP_V243_BUSINESS_DATE
  BSP_V243_SYSTEM_DATE = $env:BSP_V243_SYSTEM_DATE
  BSP_V243_DEVICE_STATUS = $env:BSP_V243_DEVICE_STATUS
  BSP_V243_SERVICE_STATUS = $env:BSP_V243_SERVICE_STATUS
  BSP_V243_ATM_MODE = $env:BSP_V243_ATM_MODE
  BSP_V243_DEPOSIT_MODE = $env:BSP_V243_DEPOSIT_MODE
  BSP_V243_OEX_SEQUENCE = $env:BSP_V243_OEX_SEQUENCE
  BSP_V243_WITHDRAWAL_SEQUENCE = $env:BSP_V243_WITHDRAWAL_SEQUENCE
  TRIPLEY_NATIVE_DIST = $env:TRIPLEY_NATIVE_DIST
}

try {
  Start-Sleep -Milliseconds 500
  $hostd.Refresh()
  if ($hostd.HasExited) {
    throw "Isolated hostd exited before the smoke test (exit code $($hostd.ExitCode))."
  }

  $env:BSP_V243_SIMULATOR_SMOKE = "1"
  $env:BSP_V243_HOSTD_PORT = "$HostdPort"
  $env:BSP_V243_SIMULATOR_HOST = $SimulatorHost
  $env:BSP_V243_SIMULATOR_PORT = "$SimulatorPort"
  $env:BSP_V243_ATM_ID = $AtmId
  $env:BSP_V243_VERSION_DATE = $VersionDate
  $env:BSP_V243_BUSINESS_DATE = $BusinessDate
  $env:BSP_V243_SYSTEM_DATE = $SystemDate
  $env:BSP_V243_DEVICE_STATUS = $DeviceStatus
  $env:BSP_V243_SERVICE_STATUS = $ServiceStatus
  $env:BSP_V243_ATM_MODE = $AtmMode
  $env:BSP_V243_DEPOSIT_MODE = $DepositMode
  $env:BSP_V243_OEX_SEQUENCE = $OexSequence
  $env:BSP_V243_WITHDRAWAL_SEQUENCE = $WithdrawalSequence
  $env:TRIPLEY_NATIVE_DIST = $NativeDist

  pnpm vitest run apps/kiosk-example/script/bsp-v243/withdrawal-simulator.smoke.test.ts
  if ($LASTEXITCODE -ne 0) {
    throw "BSP v2.43 simulator smoke failed. Confirm OEX, IWD, and IWF response rules."
  }
} finally {
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
  }
  if ($hostd -and -not $hostd.HasExited) {
    Stop-Process -Id $hostd.Id
    $hostd.WaitForExit()
  }
}
