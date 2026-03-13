@echo off
setlocal
cd /d "%~dp0"
node "%~dp0narajangteo-result-check.js" --notice R26BK01351984 --order 000 --watch --interval 300 %*
