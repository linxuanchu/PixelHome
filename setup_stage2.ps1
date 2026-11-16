param([string]$Python = "python")

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    if (!(Test-Path .\.venv\Scripts\python.exe)) {
        & $Python -m venv .venv
        if ($LASTEXITCODE) { throw "Python 3.12 environment setup failed." }
    }
    & .\.venv\Scripts\python.exe -m pip install -r requirements-stage2.txt
    if ($LASTEXITCODE) { throw "Dependency installation failed." }
    & .\.venv\Scripts\python.exe fetch_face_models.py
    if ($LASTEXITCODE) { throw "Model download or checksum validation failed." }
} finally {
    Pop-Location
}
