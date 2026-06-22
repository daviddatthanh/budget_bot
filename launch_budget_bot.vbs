Set WshShell = CreateObject("WScript.Shell")
strScriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(Wscript.ScriptFullName)
WshShell.CurrentDirectory = strScriptPath

' Start Backend FastAPI Server (venv python, --reload picks up code changes automatically)
WshShell.Run "cmd /c "".venv\Scripts\python.exe"" -m uvicorn core.api:app --host 127.0.0.1 --port 8000 --reload", 0, False

' Start Frontend Vite Server (will automatically open the browser)
WshShell.Run "cmd /c cd frontend && npm run dev", 0, False
