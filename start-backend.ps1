# SkayOffice Backend Startup Script (Windows PowerShell)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = "$root\artifacts\api-server\.env"

Write-Host ""
Write-Host "=== SkayOffice Backend ===" -ForegroundColor Cyan

# .env file se env vars load karo
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=][^=]*)=(.*)$') {
            $key = $matches[1].Trim()
            $val = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
    Write-Host "[OK] .env loaded" -ForegroundColor Green
} else {
    Write-Host "[ERROR] .env file nahi mila!" -ForegroundColor Red
    Write-Host "File banao: $envFile" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# DATABASE_URL check
if (-not $env:DATABASE_URL -or $env:DATABASE_URL -like "*xxx*") {
    Write-Host ""
    Write-Host "[ERROR] DATABASE_URL set nahi hai!" -ForegroundColor Red
    Write-Host "Neon.tech se free PostgreSQL lo aur .env me set karo" -ForegroundColor Yellow
    Write-Host "File: $envFile" -ForegroundColor Cyan
    notepad $envFile
    Read-Host "Save karke Enter dabaao..."
    exit 1
}

Write-Host "[OK] DATABASE_URL found" -ForegroundColor Green
Write-Host ""
Write-Host "Building backend..." -ForegroundColor Yellow

Set-Location "$root\artifacts\api-server"
$env:NODE_ENV = "development"

node ./build.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build fail hua!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "[OK] Build complete! Starting server on port 8080..." -ForegroundColor Green
Write-Host "API: http://localhost:8080/api/healthz" -ForegroundColor Cyan
Write-Host ""

node --enable-source-maps ./dist/index.mjs
