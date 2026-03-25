@echo off
setlocal

where go >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Go is not installed or not in PATH.
  exit /b 1
)

set "ROOT=%~dp0..\.."
set "UP=%ROOT%\scripts\up"

if not exist "%UP%" mkdir "%UP%"

pushd "%UP%"

set "CGO_ENABLED=0"
set "GOARCH=amd64"

echo Building Linux binary...
set "GOOS=linux"
go build -ldflags "-s -w" -o "up" "main.go"
if errorlevel 1 (
  popd
  exit /b 1
)

echo Building Windows binary...
set "GOOS=windows"
go build -ldflags "-s -w" -o "up.exe" "main.go"
if errorlevel 1 (
  popd
  exit /b 1
)

popd

echo Done:
echo   - up       ^(Linux ELF^)
echo   - up.exe   ^(Windows EXE^)