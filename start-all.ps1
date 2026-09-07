# SkayOffice - Dono Services Ek Saath Start Karo

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   SkayOffice - Starting All Services   " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# DATABASE_URL check karo
$envFile = "$root\artifacts\api-server\.env"
$dbLine = (Get-Content $envFile -ErrorAction SilentlyContinue) | Where-Object { $_ -match '^DATABASE_URL=' }
$dbUrl = $dbLine -replace '^DATABASE_URL=', ''

if (-not $dbUrl -or $dbUrl -like "*xxx*") {
    Write-Host "[STOP] DATABASE_URL abhi placeholder hai!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Yeh karo:" -ForegroundColor Yellow
    Write-Host "  1. https://neon.tech par FREE account banao" -ForegroundColor White
    Write-Host "  2. New Project banao => Connection string copy karo" -ForegroundColor White
    Write-Host "  3. Neeche wali file me DATABASE_URL update karo:" -ForegroundColor White
    Write-Host "     $envFile" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Format: postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require" -ForegroundColor Gray
    Write-Host ""
    $open = Read-Host "Abhi file kholein? (y/n)"
    if ($open -eq 'y') { notepad $envFile }
    exit 1
}

Write-Host "[1/2] Backend start ho raha hai (Port 8080)..." -ForegroundColor Yellow
$backend = Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "$root\start-backend.ps1" -PassThru -WindowStyle Normal

Write-Host "      Backend ke liye 8 second ruk rahe hain..." -ForegroundColor Gray
Start-Sleep -Seconds 8

Write-Host "[2/2] Frontend start ho raha hai (Port 25700)..." -ForegroundColor Yellow
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "$root\start-frontend.ps1" -PassThru -WindowStyle Normal

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   Dono Services Chal Rahe Hain!        " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  App:     http://localhost:25700" -ForegroundColor Cyan
Write-Host "  Admin:   http://localhost:25700/login-admin" -ForegroundColor Cyan
Write-Host "  API:     http://localhost:8080/api/healthz" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Admin Login:" -ForegroundColor Yellow
Write-Host "    Email:    admin@skayoffice.demo" -ForegroundColor White
Write-Host "    Password: Admin@123456" -ForegroundColor White
Write-Host ""
Write-Host "Band karne ke liye dono terminal windows close karo." -ForegroundColor Gray
