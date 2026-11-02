# Builds the image on this machine and loads it on the server.
# The server's CPU can't run the front-end build tools (no AVX), so it never builds.
#
# Usage: .\deploy.ps1 [-Server user@host] [-RemoteDir ~/store-manager]
# Server and folder default to DEPLOY_TARGET and DEPLOY_DIR in site.env (git-ignored; see
# site.env.example and docs/OPERATIONS.md). BASE_PATH for the build comes from .env here.
param(
    [string]$Server,
    [string]$RemoteDir
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Reads KEY=VALUE lines from site.env, ignoring comments and blanks.
$site = @{}
if (Test-Path site.env) {
    foreach ($line in Get-Content site.env) {
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') { $site[$Matches[1]] = $Matches[2] }
    }
}
if (-not $Server) { $Server = $site["DEPLOY_TARGET"] }
if (-not $RemoteDir) { $RemoteDir = $site["DEPLOY_DIR"] }
if (-not $RemoteDir) { $RemoteDir = "~/store-manager" }
if (-not $Server) {
    throw "No server given. Pass -Server user@host, or copy site.env.example to site.env and set DEPLOY_TARGET."
}

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
