@echo off
rem Mo portfolio qua server local de hieu ung WebGL va trang edit chay duoc (mo file truc tiep se bi trinh duyet chan)
cd /d "%~dp0"
start "" "http://127.0.0.1:8791/"
python -m http.server 8791 --bind 127.0.0.1
