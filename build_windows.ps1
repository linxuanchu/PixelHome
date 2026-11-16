param([string]$Python = (Join-Path $PSScriptRoot ".venv\Scripts\python.exe"))

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    & $Python -c "import tkinter; tkinter.Tcl()"
    if ($LASTEXITCODE) { throw "Python Tcl/Tk is unavailable. Use a full Python installation with Tcl/Tk to build the launcher." }
    & $Python -m PyInstaller --noconfirm --clean PixelHome.spec
    if ($LASTEXITCODE) { throw "Windows build failed." }
    Write-Host "Build complete: dist\PixelHome\PixelHome.exe"
} finally {
    Pop-Location
}
