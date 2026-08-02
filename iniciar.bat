@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Estudio de Videoaulas

set "PORTA=5173"

rem Le a porta salva em .config.json (se existir)
if exist ".config.json" (
  for /f %%a in ('powershell -NoProfile -Command "(Get-Content '.config.json' -Raw | ConvertFrom-Json).PORTA"') do if not "%%a"=="" set "PORTA=%%a"
)

rem Verifica se o servidor ja esta na porta
netstat -ano | findstr ":%PORTA%" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo Servidor ja esta em execucao na porta %PORTA%.
) else (
  echo Iniciando o servidor em http://localhost:%PORTA% ...
  start "servidor-videoaulas" /min cmd /c "node scripts\servidor.mjs"
  timeout /t 2 /nobreak >nul
)

echo Abrindo o navegador ...
start "" "http://localhost:%PORTA%"

echo.
echo Navegador aberto. Mantenha a janela minimizada "servidor-videoaulas"
echo aberta enquanto usar o aplicativo. Feche-a para encerrar o servidor.
echo.
pause
