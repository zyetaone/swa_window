@echo off
REM Toggles the blind closed to trigger scene change
curl -X POST http://localhost:3000/sensor ^
     -H "Content-Type: application/json" ^
     -d "{\"state\":\"closed\"}"

echo.
echo Sent closed event.
