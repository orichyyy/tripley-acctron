Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$nativeRepository = if ($env:TRIPLEY_NATIVE_REPOSITORY) {
    $env:TRIPLEY_NATIVE_REPOSITORY
} else {
    "E:\code\rust\tripley-native"
}
$hostdExecutable = if ($env:TRIPLEY_NATIVE_HOSTD_EXE) {
    $env:TRIPLEY_NATIVE_HOSTD_EXE
} else {
    Join-Path $nativeRepository "target\i686-pc-windows-msvc\debug\tripley-native-hostd.exe"
}
$supervisorExecutable = if ($env:TRIPLEY_NATIVE_HOSTD_SUPERVISOR_EXE) {
    $env:TRIPLEY_NATIVE_HOSTD_SUPERVISOR_EXE
} else {
    Join-Path $nativeRepository "target\debug\tripley-native-hostd-supervisor.exe"
}
$dllDirectory = if ($env:TRIPLEY_NATIVE_HOSTD_XFS_DLL_DIRECTORY) {
    $env:TRIPLEY_NATIVE_HOSTD_XFS_DLL_DIRECTORY
} else {
    "K:\ATMdoc\dll"
}
$simulatorUrl = if ($env:TRIPLEY_NATIVE_HOSTD_XFS_CONTROL_SIMULATOR_WS_URL) {
    $env:TRIPLEY_NATIVE_HOSTD_XFS_CONTROL_SIMULATOR_WS_URL
} else {
    "ws://127.0.0.1:39001"
}
$startupTimeoutMs = if ($env:TRIPLEY_NATIVE_HOSTD_STARTUP_TIMEOUT_MS) {
    [int]$env:TRIPLEY_NATIVE_HOSTD_STARTUP_TIMEOUT_MS
} else {
    15000
}
$soakCycles = if ($env:TRIPLEY_XFS_SOAK_CYCLES) {
    [int]$env:TRIPLEY_XFS_SOAK_CYCLES
} else {
    2
}

function Assert-Prerequisites {
    if (-not (Test-Path -LiteralPath $hostdExecutable -PathType Leaf)) {
        throw "tripley-native-hostd executable was not found at '$hostdExecutable'. Build it or set TRIPLEY_NATIVE_HOSTD_EXE."
    }
    if (-not (Test-Path -LiteralPath $supervisorExecutable -PathType Leaf)) {
        throw "tripley-native-hostd-supervisor executable was not found at '$supervisorExecutable'. Build it or set TRIPLEY_NATIVE_HOSTD_SUPERVISOR_EXE."
    }
    if (-not (Test-Path -LiteralPath $dllDirectory -PathType Container)) {
        throw "XFS DLL directory was not found at '$dllDirectory'. Set TRIPLEY_NATIVE_HOSTD_XFS_DLL_DIRECTORY."
    }
}

function Wait-ForStartedEvent {
    param(
        [Parameter(Mandatory)] [System.Diagnostics.Process] $Process,
        [Parameter(Mandatory)] [string] $StdoutPath,
        [Parameter(Mandatory)] [int] $TimeoutMs
    )

    $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "tripley-native-hostd exited before reporting readiness with code $($Process.ExitCode)."
        }
        if (Test-Path -LiteralPath $StdoutPath) {
            foreach ($line in Get-Content -LiteralPath $StdoutPath -ErrorAction SilentlyContinue) {
                try {
                    $event = $line | ConvertFrom-Json -ErrorAction Stop
                    if ($event.event -eq "started" -and $event.transport -eq "websocket") {
                        return $event
                    }
                } catch {
                    continue
                }
            }
        }
        Start-Sleep -Milliseconds 50
    }
    throw "Timed out waiting for tripley-native-hostd readiness after ${TimeoutMs}ms."
}

function Stop-ManagedProcess {
    param([System.Diagnostics.Process] $Process)

    if ($null -eq $Process -or $Process.HasExited) {
        return
    }
    Stop-DescendantProcesses -ParentId $Process.Id
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
}

function Wait-ForWorkerStoppedEvent {
    param(
        [Parameter(Mandatory)] [System.Diagnostics.Process] $Process,
        [Parameter(Mandatory)] [string] $StdoutPath,
        [Parameter(Mandatory)] [int] $Generation,
        [Parameter(Mandatory)] [int] $TimeoutMs
    )

    $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "tripley-native-hostd-supervisor exited while waiting for worker generation $Generation to stop."
        }
        foreach ($line in Get-Content -LiteralPath $StdoutPath -ErrorAction SilentlyContinue) {
            try {
                $event = $line | ConvertFrom-Json -ErrorAction Stop
                if ($event.event -eq "worker_stopped" -and $event.generation -eq $Generation) {
                    return
                }
            } catch {
                continue
            }
        }
        Start-Sleep -Milliseconds 50
    }
    throw "Timed out waiting for hostd worker generation $Generation to stop."
}

function Stop-DescendantProcesses {
    param([int] $ParentId)

    foreach ($child in Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentId" -ErrorAction SilentlyContinue) {
        Stop-DescendantProcesses -ParentId $child.ProcessId
        Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Restore-EnvironmentValue {
    param([string] $Name, [AllowNull()] [string] $Value)

    if ($null -eq $Value) {
        Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
    } else {
        Set-Item "Env:$Name" $Value
    }
}

Assert-Prerequisites

$runId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ([Guid]::NewGuid().ToString("N").Substring(0, 8))
$artifactDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "tripley-acctron-xfs-hostd\$runId"
New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
$stdoutPath = Join-Path $artifactDirectory "hostd.stdout.log"
$stderrPath = Join-Path $artifactDirectory "hostd.stderr.log"
$hostd = $null
$previousUrl = $env:TRIPLEY_NATIVE_HOSTD_URL
$previousExpectedGeneration = $env:TRIPLEY_XFS_EXPECTED_GENERATION

try {
    $arguments = @(
        "--addr", "127.0.0.1:0",
        "--worker-exe", $hostdExecutable,
        "--startup-timeout-ms", $startupTimeoutMs,
        "--",
        "--transport", "websocket",
        "--services", "xfs,xfs-control",
        "--dev-permissive",
        "--xfs-dll-directory", $dllDirectory,
        "--xfs-control-simulator-ws-url", $simulatorUrl
    )
    if ($env:TRIPLEY_NATIVE_HOSTD_AUTH_TOKEN) {
        $arguments += @("--auth-token", $env:TRIPLEY_NATIVE_HOSTD_AUTH_TOKEN)
    }

    $hostd = Start-Process `
        -FilePath $supervisorExecutable `
        -ArgumentList $arguments `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath

    $started = Wait-ForStartedEvent -Process $hostd -StdoutPath $stdoutPath -TimeoutMs $startupTimeoutMs
    $env:TRIPLEY_NATIVE_HOSTD_URL = "ws://$($started.addr)"
    Write-Host "Managed tripley-native-hostd PID $($hostd.Id) is ready at $env:TRIPLEY_NATIVE_HOSTD_URL"
    Write-Host "Hostd logs: $artifactDirectory"

    Push-Location $repositoryRoot
    try {
        for ($generation = 1; $generation -le $soakCycles; $generation++) {
            $env:TRIPLEY_XFS_EXPECTED_GENERATION = $generation.ToString()
            Write-Host "Running XFS hostd contract generation $generation of $soakCycles"
            & pnpm run test:xfs-hostd:contract
            if ($LASTEXITCODE -ne 0) {
                throw "XFS hostd contract generation $generation failed with exit code $LASTEXITCODE. Hostd logs: $artifactDirectory"
            }
            Wait-ForWorkerStoppedEvent `
                -Process $hostd `
                -StdoutPath $stdoutPath `
                -Generation $generation `
                -TimeoutMs $startupTimeoutMs
        }
    } finally {
        Pop-Location
    }
} finally {
    Restore-EnvironmentValue -Name "TRIPLEY_NATIVE_HOSTD_URL" -Value $previousUrl
    Restore-EnvironmentValue -Name "TRIPLEY_XFS_EXPECTED_GENERATION" -Value $previousExpectedGeneration
    Stop-ManagedProcess -Process $hostd
}
