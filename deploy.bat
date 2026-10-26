@echo off
REM ===== Dua portfolio len web (nxvinh.pages.dev) + luu GitHub =====
REM Bam dup file nay sau khi sua va Luu trong trang edit.
set PROJECT=nxvinh
cd /d "%~dp0"
title Dua len web

echo.
echo [1/3] Dung thu muc site ...
if exist site rmdir /s /q site
mkdir site
copy /y index.html site\ >nul
if exist robots.txt copy /y robots.txt site\ >nul
if exist sitemap.xml copy /y sitemap.xml site\ >nul
xcopy js site\js\ /e /i /q /y >nul
xcopy img site\img\ /e /i /q /y >nul

echo [2/3] Dua len Cloudflare (lan dau mat 1-2 phut tai wrangler, cu doi) ...
call npx --yes wrangler@3 pages deploy site --project-name=%PROJECT% --branch=main --commit-dirty=true
if errorlevel 1 (
  echo.
  echo [LOI] Deploy Cloudflare khong thanh cong. Chup man hinh cua so nay gui cho Claude.
  echo Neu thay chu "login" thi chay:  npx wrangler@3 login   roi bam lai file nay.
  echo.
  pause
  exit /b 1
)

echo.
echo [3/3] Luu len GitHub ...
git add -A
git commit -q -m "Cap nhat tu trang edit %date% %time%"
git push || echo (Khong day len GitHub duoc, nhung web da cap nhat.)

echo.
echo XONG. Doi 30 giay roi mo https://%PROJECT%.pages.dev va bam Ctrl+Shift+R
echo.
pause
