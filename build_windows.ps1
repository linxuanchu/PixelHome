$ErrorActionPreference = "Stop"
$env:PYTHONPATH = (Join-Path $PSScriptRoot ".build-deps")
& "C:\Users\Mrlin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m PyInstaller --noconfirm --clean PixelHome.spec
Write-Host "Build complete: dist\PixelHome\PixelHome.exe"
