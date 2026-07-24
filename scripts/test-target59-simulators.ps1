param(
  [string]$HostdUrl = "ws://127.0.0.1:39010",
  [string]$NativeDist = "E:\code\front-end\tripley-kit\libs\native\dist\index.js",
  [string]$SimulatorHost = "127.0.0.1",
  [int]$SimulatorPort = 12008
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $NativeDist)) {
  throw "@tripley-kit/native dist not found: $NativeDist"
}

pnpm --filter @tripley-kit/web-container-xfs-device-service build
if ($LASTEXITCODE -ne 0) {
  throw "Unable to build @tripley-kit/web-container-xfs-device-service for the Target 59 smoke."
}

$probe = [System.Net.Sockets.TcpClient]::new()
try {
  $connect = $probe.ConnectAsync($SimulatorHost, $SimulatorPort)
  if (-not $connect.Wait(1500) -or -not $probe.Connected) {
    throw "tripley-host-simulator is not listening on ${SimulatorHost}:${SimulatorPort}."
  }
} finally {
  $probe.Dispose()
}

$previous = @{
  TARGET59_SIMULATOR_SMOKE = $env:TARGET59_SIMULATOR_SMOKE
  TARGET59_SIMULATOR_CONFIRM = $env:TARGET59_SIMULATOR_CONFIRM
  TARGET59_HOSTD_URL = $env:TARGET59_HOSTD_URL
  BSP_V243_SIMULATOR_HOST = $env:BSP_V243_SIMULATOR_HOST
  BSP_V243_SIMULATOR_PORT = $env:BSP_V243_SIMULATOR_PORT
  TRIPLEY_NATIVE_DIST = $env:TRIPLEY_NATIVE_DIST
}

try {
  $env:TARGET59_SIMULATOR_SMOKE = "1"
  $env:TARGET59_SIMULATOR_CONFIRM = "I_UNDERSTAND_SIMULATOR_ONLY"
  $env:TARGET59_HOSTD_URL = $HostdUrl
  $env:BSP_V243_SIMULATOR_HOST = $SimulatorHost
  $env:BSP_V243_SIMULATOR_PORT = "$SimulatorPort"
  $env:TRIPLEY_NATIVE_DIST = $NativeDist

  pnpm vitest run apps/kiosk-example/script/bsp-v243/withdrawal-application-simulator.smoke.test.ts
  if ($LASTEXITCODE -ne 0) {
    throw "Target 59 smoke failed. Hostd must expose runtime,tcp,xfs,xfs-control and the BSP listener must be active."
  }
} finally {
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
  }
}
