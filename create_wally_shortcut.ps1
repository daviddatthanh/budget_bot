# Adds "Wally" and "Stop Wally" shortcuts to your Start Menu so you can press the
# Windows key, type "Wally", and launch it silently (no console window).
# Run "Add Wally to Start Menu.bat" to use this.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$programs = [Environment]::GetFolderPath('Programs')
$icon = (Join-Path $root 'icon\wally.ico') + ',0'

# Launch silently with pythonw (no console). Prefer the project venv, then a
# system pythonw, falling back to PATH.
$pyw = Join-Path $root '.venv\Scripts\pythonw.exe'
if (-not (Test-Path $pyw)) {
    $cmd = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if ($cmd) { $pyw = $cmd.Source } else { $pyw = 'pythonw.exe' }
}

$ws = New-Object -ComObject WScript.Shell

$run = $ws.CreateShortcut((Join-Path $programs 'Wally.lnk'))
$run.TargetPath = $pyw
$run.Arguments = 'start.py'
$run.WorkingDirectory = $root
$run.IconLocation = $icon
$run.Description = 'Wally - Personal Finance Command Center'
$run.Save()

$stop = $ws.CreateShortcut((Join-Path $programs 'Stop Wally.lnk'))
$stop.TargetPath = $pyw
$stop.Arguments = 'stop.py'
$stop.WorkingDirectory = $root
$stop.IconLocation = $icon
$stop.Description = 'Stop Wally (shut down the servers)'
$stop.Save()

Write-Host ""
Write-Host "Added to Start Menu:"
Write-Host "  - Wally       (press Windows key, type 'Wally', Enter)"
Write-Host "  - Stop Wally  (to shut it down)"
