# Marketing Bot Deployment Script
# Usage: .\deploy-marketing.ps1

$ErrorActionPreference = "Stop"

$ServerIP = "46.62.142.237"
$User = "root"
$RemoteDir = "/opt/marketing-bot"
$LocalDir = "c:\Users\Petr\Logos"
$Remote = "${User}@${ServerIP}"
$SshOpts = "-o ConnectTimeout=10 -o BatchMode=yes"

$FilesToUpload = @(
    ".env",
    "openclaw.json",
    "docker-compose.yml",
    "AGENTS.md",
    ".gitignore"
)
$DirsToUpload = @(
    "skills",
    "source"
)

Write-Host "=== Deploying Marketing Bot to $ServerIP ===" -ForegroundColor Cyan
Write-Host "NOTE: Uploading 'source' (200MB+) may take several minutes. Please wait..." -ForegroundColor Gray

# 1. Create remote directory
Write-Host "[1/3] Creating remote directory..." -ForegroundColor Yellow
ssh $SshOpts $Remote "mkdir -p ${RemoteDir}/data"
Write-Host "  Done." -ForegroundColor Green

# 2. Upload config and data
Write-Host "[2/3] Uploading configuration, source and skills..." -ForegroundColor Yellow
foreach ($file in $FilesToUpload) {
    $path = Join-Path $LocalDir $file
    if (Test-Path $path) {
        Write-Host "  -> $file"
        scp $SshOpts "$path" "${Remote}:${RemoteDir}/"
    }
}
foreach ($dir in $DirsToUpload) {
    $path = Join-Path $LocalDir $dir
    if (Test-Path $path) {
        Write-Host "  -> $dir/"
        # Use -p to preserve permissions and -C for compression
        scp $SshOpts -r -p -C "$path" "${Remote}:${RemoteDir}/"
    }
}
Write-Host "  Done." -ForegroundColor Green

# 3. Start Docker
Write-Host "[3/3] Starting OpenClaw Marketing Bot..." -ForegroundColor Yellow
Write-Host "This will build the image from source, which takes 2-5 minutes..." -ForegroundColor Gray
ssh $SshOpts $Remote "cd ${RemoteDir} && docker compose down && docker compose up -d --build"
Write-Host "  Done." -ForegroundColor Green

Write-Host ""
Write-Host "=== Deployment Complete! ===" -ForegroundColor Cyan
Write-Host "Бот должен быть доступен в Telegram."
