@echo off
setlocal
if "%~1"=="" (
  echo Drag the captures folder onto this file.
  echo Or run: transfer.cmd "D:\captures" --output "D:\labels-new.json"
  pause
  exit /b 2
)
py -3 "%~dp0python\transfer.py" %*
set "transfer_result=%ERRORLEVEL%"
pause
exit /b %transfer_result%
