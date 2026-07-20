<#
.SYNOPSIS
  JobMatch VN - Local database bootstrap (Windows / PowerShell).
.DESCRIPTION
  Creates the `jobmatch` role and `jobmatch_vn` database, then applies every
  migration under ../src/db/migrations/*.sql in alphabetical order.
  Idempotent: safe to re-run (drops & recreates the dev database).

  Credentials match backend/.env.example + docker-compose.yml so the app
  connects out-of-the-box after this script.

  Default app credentials (created by this script):
    Database : jobmatch_vn
    User     : jobmatch
    Password : jobmatch_dev_pwd

.PARAMETER SuperPassword
  Password of the PostgreSQL superuser. Prompted if not provided and
  $env:PGPASSWORD is empty.

.PARAMETER SuperUser
  PostgreSQL superuser name (default: postgres).

.EXAMPLE
  .\setup-local-db.ps1
  .\setup-local-db.ps1 -SuperPassword 123456
#>
[CmdletBinding()]
param(
    [string]$SuperUser = 'postgres',
    [string]$SuperPassword = ''
)

# NOTE: do NOT set $ErrorActionPreference='Stop' here — psql writes benign
# NOTICEs to stderr which PowerShell would otherwise treat as terminating.

# --- Config ----------------------------------------------------------------
$DbName   = 'jobmatch_vn'
$DbUser   = 'jobmatch'
$DbPass   = 'jobmatch_dev_pwd'

$ScriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$MigrationsDir = Join-Path $ScriptDir '..\src\db\migrations'

# --- Locate psql.exe -------------------------------------------------------
function Find-Psql {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $guesses = 13..18 | ForEach-Object { "C:\Program Files\PostgreSQL\$_\bin\psql.exe" }
    foreach ($g in $guesses) { if (Test-Path $g) { return $g } }
    return $null
}

$psql = Find-Psql
if (-not $psql) {
    Write-Host "psql.exe not found." -ForegroundColor Red
    Write-Host "   Install PostgreSQL (https://www.postgresql.org/download/windows/)" -ForegroundColor Yellow
    Write-Host "   or add its bin folder to PATH, then re-run." -ForegroundColor Yellow
    exit 1
}
Write-Host "Using psql: $psql" -ForegroundColor DarkGray
& $psql --version

# --- Superuser password ----------------------------------------------------
if (-not $SuperPassword -and -not $env:PGPASSWORD) {
    $sec = Read-Host "Password for superuser '$SuperUser'" -AsSecureString
    $SuperPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$env:PGPASSWORD = $SuperPassword

# Helper: run psql, fail hard on non-zero exit for critical steps.
function Assert-PsqlOk([int]$Code, [string]$What) {
    if ($Code -ne 0) {
        Write-Host "FAILED: $What (psql exit $Code)" -ForegroundColor Red
        exit 1
    }
}

# --- Create role -----------------------------------------------------------
Write-Host "`n==> Creating role '$DbUser'..." -ForegroundColor Cyan
& $psql -h localhost -U $SuperUser -d postgres -q -v ON_ERROR_STOP=0 -c `
    "DROP ROLE IF EXISTS $DbUser; CREATE ROLE $DbUser WITH LOGIN PASSWORD '$DbPass';" 2>$null
Assert-PsqlOk $LASTEXITCODE "create role"

# --- Drop + create database ------------------------------------------------
Write-Host "==> Creating database '$DbName'..." -ForegroundColor Cyan
& $psql -h localhost -U $SuperUser -d postgres -q -v ON_ERROR_STOP=0 -c `
    "DROP DATABASE IF EXISTS $DbName;" 2>$null
& $psql -h localhost -U $SuperUser -d postgres -c "CREATE DATABASE $DbName OWNER $DbUser;"
Assert-PsqlOk $LASTEXITCODE "create database"

# --- Apply migrations ------------------------------------------------------
if (-not (Test-Path $MigrationsDir)) {
    Write-Host "Migrations folder not found: $MigrationsDir" -ForegroundColor Red
    exit 1
}
$migrations = Get-ChildItem -Path $MigrationsDir -Filter *.sql | Sort-Object Name
Write-Host "`n==> Applying $($migrations.Count) migration(s) from src/db/migrations:" -ForegroundColor Cyan
foreach ($m in $migrations) {
    Write-Host "   - $($m.Name)" -ForegroundColor DarkGray
    # ON_ERROR_STOP=0: a missing pgvector extension skips only the embeddings
    # table; the rest of the schema still applies.
    & $psql -h localhost -U $SuperUser -d $DbName -v ON_ERROR_STOP=0 -f $m.FullName 2>&1 `
        | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | Out-Host
}

# --- Grants ----------------------------------------------------------------
Write-Host "`n==> Granting privileges to '$DbUser'..." -ForegroundColor Cyan
& $psql -h localhost -U $SuperUser -d $DbName -c "
    GRANT ALL ON SCHEMA public TO $DbUser;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DbUser;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DbUser;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DbUser;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DbUser;"
Assert-PsqlOk $LASTEXITCODE "grant privileges"

# --- Verify ----------------------------------------------------------------
$tableCount = (& $psql -h localhost -U $SuperUser -d $DbName -tAc `
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';").Trim()
Write-Host "`nDone. Tables in '$DbName' (public): $tableCount" -ForegroundColor Green

# pgvector check
$embExists = (& $psql -h localhost -U $SuperUser -d $DbName -tAc `
    "SELECT to_regclass('public.embeddings') IS NOT NULL;").Trim()
if ($embExists -eq 'f') {
    Write-Host "`nWARNING: the 'embeddings' table was NOT created." -ForegroundColor Yellow
    Write-Host "   The pgvector extension is not installed on this PostgreSQL." -ForegroundColor Yellow
    Write-Host "   Install pgvector (or use the pgvector/pgvector Docker image)," -ForegroundColor Yellow
    Write-Host "   then run:  CREATE EXTENSION vector;  and re-apply the migration." -ForegroundColor Yellow
    Write-Host "   This only affects AI vector-search; the rest of the app works." -ForegroundColor DarkGray
}

Write-Host "`nConnection string (put this in backend/.env as DATABASE_URL):" -ForegroundColor Cyan
Write-Host "  postgresql://${DbUser}:${DbPass}@localhost:5432/${DbName}" -ForegroundColor White
Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host "  cd backend; npm install; npm run dev" -ForegroundColor White
