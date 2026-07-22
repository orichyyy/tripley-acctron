param(
  [string]$HostdExe = "E:\code\rust\tripley-native\target\i686-pc-windows-msvc\debug\tripley-native-hostd.exe",
  [int]$HostdPort = 39012,
  [string]$SimulatorHost = "127.0.0.1",
  [int]$SimulatorPort = 12008
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $HostdExe)) {
  throw "tripley-native-hostd not found: $HostdExe"
}

$hostd = Start-Process -FilePath $HostdExe -ArgumentList @(
  "--transport", "websocket",
  "--addr", "127.0.0.1:$HostdPort",
  "--services", "runtime,tcp",
  "--dev-permissive"
) -WindowStyle Hidden -PassThru

try {
  Start-Sleep -Milliseconds 500
  $hostd.Refresh()
  if ($hostd.HasExited) {
    throw "isolated hostd exited before the smoke test (exit code $($hostd.ExitCode))"
  }

  node scripts/host-simulator-smoke.mjs `
    "--hostdPort=$HostdPort" `
    "--simulatorHost=$SimulatorHost" `
    "--simulatorPort=$SimulatorPort"
  if ($LASTEXITCODE -ne 0) {
    throw "Host simulator smoke failed through isolated hostd ${HostdPort} and simulator ${SimulatorHost}:$SimulatorPort."
  }
} finally {
  if ($hostd -and -not $hostd.HasExited) {
    Stop-Process -Id $hostd.Id
    $hostd.WaitForExit()
  }
}
