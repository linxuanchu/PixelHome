param(
    [string]$SerialPort,
    [int]$Port = 8000,
    [ValidateSet("hybrid", "specialized")][string]$Vision = "hybrid",
    [ValidateRange(0.0, 1.0)][double]$ExtinguisherConfidence
)

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    $python = ".\.venv\Scripts\python.exe"
    if (!(Test-Path $python)) { throw "Run setup_stage2.ps1 first." }
    $arguments = @("run.py", "--port", $Port, "--vision", $Vision, "--face-model-dir", "models/face")
    if ($SerialPort) { $arguments += @("--serial-port", $SerialPort) }
    if ($PSBoundParameters.ContainsKey("ExtinguisherConfidence")) {
        if ($Vision -ne "hybrid") { throw "ExtinguisherConfidence requires Hybrid mode." }
        $arguments += @("--extinguisher-confidence", $ExtinguisherConfidence.ToString([System.Globalization.CultureInfo]::InvariantCulture))
    }
    & $python @arguments
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
