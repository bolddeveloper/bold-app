<#
Local-only PostgreSQL validation. No service installation, cloud or production
credentials. Obtain portable binaries from the official EDB page linked by
postgresql.org. ValidationRoot must be an exclusive direct child of Temp or
LOCALAPPDATA/BOLDApp/validation (persistent Google acceptance only).
Generated test credentials stay in an ACL-restricted file outside the repo.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ValidationRoot,
    [ValidateRange(1024,65535)][int]$Port = 55432,
    [ValidateSet('Test','PrepareStaging','RunStaging')][string]$Action = 'Test',
    [string[]]$TestLabels = @('boldApp.mensajeria','boldApp.notificaciones.tests.test_notifications','boldApp.core.tests.test_authorization','boldApp.tareas.tests.test_task_collaboration')
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$allowedParents = @($tempRoot)
if ($env:LOCALAPPDATA -and [IO.Path]::IsPathFullyQualified($env:LOCALAPPDATA)) {
    $allowedParents += [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'BOLDApp\validation')).TrimEnd('\')
}
$validationPath = (Resolve-Path -LiteralPath $ValidationRoot).Path.TrimEnd('\')
if ((Split-Path -Parent $validationPath) -notin $allowedParents -or
    (Split-Path -Leaf $validationPath) -notmatch '^bold-channel-postgres-[a-f0-9]{32}$') {
    throw 'ValidationRoot must be an exclusive bold-channel-postgres-<uuid> directory directly under Temp or LOCALAPPDATA/BOLDApp/validation.'
}
$pgBin = Join-Path $validationPath 'pgsql\bin'
$pgData = Join-Path $validationPath 'data'
$pgSecret = Join-Path $validationPath 'test-password.txt'
$python = Join-Path $repoRoot '.venv\Scripts\python.exe'
foreach ($required in @($python,(Join-Path $pgBin 'initdb.exe'),(Join-Path $pgBin 'pg_ctl.exe'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {throw "Missing prerequisite: $required"}
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is occupied. This script will not stop or reuse an unknown server."
}
function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) {throw "$Step failed (exit $LASTEXITCODE)."}
}
if (-not (Test-Path -LiteralPath $pgSecret)) {
    $randomBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
    $password = [Convert]::ToHexString($randomBytes)
    [IO.File]::WriteAllText($pgSecret,$password,[Text.UTF8Encoding]::new($false))
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($currentIdentity,'FullControl','Allow'))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl','Allow'))
    Set-Acl -LiteralPath $pgSecret -AclObject $acl
}
$password = [IO.File]::ReadAllText($pgSecret).Trim()
if ($password -notmatch '^[A-F0-9]{64}$') {throw 'Unexpected local test credential format.'}
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
    & (Join-Path $pgBin 'initdb.exe') -D $pgData -U bold_validation_admin --pwfile=$pgSecret --auth=scram-sha-256 --encoding=UTF8 --locale=C
    Assert-NativeSuccess 'initdb'
}
if (([IO.File]::ReadAllText((Join-Path $pgData 'PG_VERSION'))).Trim() -ne '18') {
    throw 'Validation requires PostgreSQL major version 18, matching compose.oracle.yaml.'
}
$previousPgPassword = $env:PGPASSWORD
$previousPgEncoding = $env:PGCLIENTENCODING
$previousTestUrl = $env:BOLD_TEST_DATABASE_URL
$previousStagingDir = $env:BOLD_CHANNEL_STAGING_DIR
$started = $false
try {
    # Portable Windows distributions may omit legacy code-page conversion DLLs.
    # The isolated database and the test output are UTF-8; do not infer WIN1252
    # from the interactive console or change the developer's permanent settings.
    $env:PGCLIENTENCODING = 'UTF8'
    & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -l (Join-Path $validationPath 'postgres.log') -w -t 25 -o "-h 127.0.0.1 -p $Port -c max_connections=30 -c shared_buffers=32MB" start
    Assert-NativeSuccess 'pg_ctl start'
    $started = $true
    $env:PGPASSWORD = $password
    $exists = & (Join-Path $pgBin 'psql.exe') -X -P pager=off -h 127.0.0.1 -p $Port -U bold_validation_admin -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='bold_validation'"
    Assert-NativeSuccess 'database lookup'
    if ($exists -ne '1') {
        & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $Port -U bold_validation_admin bold_validation
        Assert-NativeSuccess 'createdb'
    }
    & (Join-Path $pgBin 'psql.exe') -X -P pager=off -h 127.0.0.1 -p $Port -U bold_validation_admin -d bold_validation -c 'SELECT version(), inet_server_addr(), inet_server_port();'
    Assert-NativeSuccess 'server identity'
    $env:BOLD_TEST_DATABASE_URL = "postgresql://bold_validation_admin:${password}@127.0.0.1:${Port}/bold_validation"
    Push-Location (Join-Path $repoRoot 'backend')
    try {
        if ($Action -ne 'Test') {
            $stagingSecret = Join-Path $validationPath 'staging-secret.txt'
            if (-not (Test-Path -LiteralPath $stagingSecret)) {
                $stagingBytes = [byte[]]::new(64)
                [Security.Cryptography.RandomNumberGenerator]::Fill($stagingBytes)
                $stagingSigning = [Convert]::ToHexString($stagingBytes[0..31])
                $stagingEncryption = [Convert]::ToHexString($stagingBytes[32..63])
                [IO.File]::WriteAllText($stagingSecret,"${stagingSigning}:${stagingEncryption}",[Text.UTF8Encoding]::new($false))
                Set-Acl -LiteralPath $stagingSecret -AclObject (Get-Acl -LiteralPath $pgSecret)
            }
            $env:BOLD_CHANNEL_STAGING_DIR = $validationPath
            & $python manage.py migrate --settings=config.settings_channel_staging --noinput
            Assert-NativeSuccess 'isolated staging migration'
            & $python manage.py check --settings=config.settings_channel_staging
            Assert-NativeSuccess 'isolated staging configuration'
            Write-Output 'Staging database prepared. No accounts/OAuth/Drive connections were imported or authorized.'
            if ($Action -eq 'RunStaging') {
                Write-Output 'Local staging backend: http://127.0.0.1:8160/. Google/account provisioning is a separate authorized step.'
                & $python manage.py runserver 127.0.0.1:8160 --noreload --verbosity=0 --settings=config.settings_channel_staging
                Assert-NativeSuccess 'isolated staging server'
            }
        } else {
            & $python manage.py test @TestLabels --settings=config.settings_test_postgres --noinput --verbosity=2 2>&1 |
                ForEach-Object {
                    # Keep test evidence without printing synthetic seeded credentials.
                    if ($_ -notmatch '(?i)(password|contrase|clave temporal|@bold\.gt|correo:)') { Write-Output $_ }
                } | Tee-Object -FilePath (Join-Path $validationPath 'integration-tests.log')
            Assert-NativeSuccess 'PostgreSQL integration tests'
        }
    } finally {Pop-Location}
} finally {
    $env:PGPASSWORD = $previousPgPassword
    $env:PGCLIENTENCODING = $previousPgEncoding
    $env:BOLD_TEST_DATABASE_URL = $previousTestUrl
    $env:BOLD_CHANNEL_STAGING_DIR = $previousStagingDir
    if ($started) {
        if (Test-Path -LiteralPath (Join-Path $pgData 'postmaster.pid')) {
            & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -w -t 25 -m fast stop
            if ($LASTEXITCODE -ne 0) {Write-Warning 'The isolated PostgreSQL process needs an explicit pg_ctl stop.'}
        } elseif (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue)) {
            Write-Output 'Isolated PostgreSQL already stopped (console interruption).'
        } else {
            Write-Warning 'The process lost its PID file but the port remains occupied; inspect before taking any action.'
        }
    }
}
