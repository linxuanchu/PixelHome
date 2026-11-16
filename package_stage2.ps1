param([switch]$WithFaceModels)

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    $python = ".\.venv\Scripts\python.exe"
    if ($WithFaceModels) {
        & $python fetch_face_models.py
        if ($LASTEXITCODE) { throw "Cannot verify face models." }
    }
    New-Item -ItemType Directory -Force artifacts | Out-Null
    $options = @()
    if ($WithFaceModels) { $options += "--with-face-models" }
    & $python -m tools.package_stage2 @options
    if ($LASTEXITCODE) { throw "ZIP packaging failed." }
} finally {
    Pop-Location
}
