# Adds a "Wally" shortcut to your Start Menu so you can press the Windows key,
# type "Wally", and launch it silently (no console window). Wally stops on its
# own when you close the browser, so there's no separate stop shortcut.
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

# Remove the old "Stop Wally" shortcut if a previous version created one —
# Wally now stops by itself when you close the browser.
$old = Join-Path $programs 'Stop Wally.lnk'
if (Test-Path $old) { Remove-Item $old -Force }

Write-Host ""
Write-Host "Added 'Wally' to the Start Menu."
Write-Host "Press the Windows key, type 'Wally', and hit Enter to launch."
Write-Host "It stops on its own when you close the browser."
