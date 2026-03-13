@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo 사용법: %~n0 내-ntfy-토픽명
  exit /b 1
)

node "%~dp0narajangteo-result-check.js" --notice R26BK01351984 --order 000 --watch --interval 300 --ntfy-topic "%~1"
