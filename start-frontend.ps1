# SkayOffice Frontend Startup Script (Windows PowerShell)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = "$root\artifacts\skayoffice-pilot\.env"

Write-Host ""
Write-Host "=== SkayOffice Frontend ===" -ForegroundColor Cyan

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
    exit 1
}

Write-Host ""
Write-Host "Starting Vite dev server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Frontend:  http://localhost:25700" -ForegroundColor Green
Write-Host "  Admin:     http://localhost:25700/login-admin" -ForegroundColor Green
Write-Host ""

Set-Location "$root\artifacts\skayoffice-pilot"
pnpm run dev
