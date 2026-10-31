# Builds the image on this machine and loads it on the server.
# The server's CPU can't run the front-end build tools (no AVX), so it never builds.
#
# Usage: .\deploy.ps1 -Server <DEPLOY_TARGET> [-RemoteDir ~/store-manager]
# BASE_PATH for the build comes from .env here (see .env.example).
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$RemoteDir = "~/store-manager"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$tar = Join-Path $env:TEMP "store-manager.tar"

function Invoke-Checked([string]$what, [scriptblock]$cmd) {
    Write-Host "==> $what"
    & $cmd
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

try {
    Invoke-Checked "Building image" { docker compose build app }
    # -o writes the file directly; piping docker save through PowerShell corrupts the tar.
    Invoke-Checked "Saving image" { docker save -o $tar store-manager:latest }
    Invoke-Checked "Copying docker-compose.yml and image to $Server" {
        scp docker-compose.yml $tar "${Server}:$RemoteDir/"
    }
    Invoke-Checked "Loading and restarting on $Server" {
        ssh $Server "cd $RemoteDir && docker load -i store-manager.tar && rm store-manager.tar && docker compose up -d --no-build"
    }
    Invoke-Checked "Health check" {
        ssh $Server "sleep 3; cd $RemoteDir && docker compose exec -T app node server/dist/healthcheck.js"
    }
    Write-Host "Deployed."
}
finally {
    if (Test-Path $tar) { Remove-Item $tar -Force }
}
