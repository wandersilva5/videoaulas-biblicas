@echo off
node scripts\servidor.mjs > server_output.txt 2>&1
echo Exit code: %errorlevel%
type server_output.txt