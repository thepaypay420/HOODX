@echo off
rem HUNTX forward shadow test (read-only). Scheduled daily; safe to re-run.
cd /d "%~dp0.."
echo ==== %DATE% %TIME% ==== >> "%~dp0run.log"
"C:\Users\lukey\AppData\Local\Microsoft\WindowsApps\python.exe" huntx_forward_shadow.py >> "%~dp0run.log" 2>&1
echo exit %ERRORLEVEL% >> "%~dp0run.log"
