@echo off
cd /d "%~dp0" || exit /b 1
py -3 --version >nul 2>&1
if errorlevel 1 goto use_python
py -3 local_server.py --auto-exit
goto done
:use_python
python local_server.py --auto-exit
:done
if not errorlevel 1 exit /b 0
echo.
echo Could not start Dear Editor. Install Python 3 or check the message above.
pause
exit /b 1
