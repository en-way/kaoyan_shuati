Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

quizAppDir = currentDir & "\quiz-app"
pythonExe = "python"

If fso.FileExists("C:\Program Files\Python312\python.exe") Then
    pythonExe = """C:\Program Files\Python312\python.exe"""
End If

ws.CurrentDirectory = quizAppDir
ws.Run pythonExe & " run_quiz.py", 0, False
