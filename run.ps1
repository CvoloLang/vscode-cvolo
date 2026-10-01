[CmdletBinding()]
param(
    [string]$Workspace = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$code = Get-Command code -ErrorAction SilentlyContinue
if (-not $code) {
    throw "VS Code CLI ('code') was not found in PATH."
}

$extensionRoot = (Resolve-Path $PSScriptRoot).Path
$workspacePath = (Resolve-Path $Workspace).Path

Write-Host "Starting VS Code Extension Development Host..."
Write-Host "Extension: $extensionRoot"
Write-Host "Workspace: $workspacePath"

& $code.Source `
    --new-window `
    --extensionDevelopmentPath="$extensionRoot" `
    "$workspacePath"

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
