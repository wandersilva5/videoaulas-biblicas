@echo off
cd /d "%~dp0"
rem Recompila a interface React (frontend\ -> web\dist) antes de subir.
if exist "frontend\node_modules" (
  pushd frontend
  call npm run build
  popd
)
node scripts\servidor.mjs > server_output.txt 2>&1
echo Exit code: %errorlevel%
type server_output.txt