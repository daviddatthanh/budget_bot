# Creates a "Wally" shortcut in your Start Menu so you can press the Windows key,
# type "Wally", and launch it. Run "Add Wally to Start Menu.bat" to use this.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$programs = [Environment]::GetFolderPath('Programs')
$lnk = Join-Path $programs 'Wally.lnk'

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = Join-Path $root 'start.bat'
$sc.WorkingDirectory = $root
$sc.IconLocation = (Join-Path $root 'icon\wally.ico') + ',0'
$sc.Description = 'Wally - Personal Finance Command Center'
$sc.WindowStyle = 1
$sc.Save()

Write-Host ""
Write-Host "Created Start Menu shortcut: $lnk"
Write-Host 'Press the Windows key and type "Wally" to launch.'
