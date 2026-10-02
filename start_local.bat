@echo off
chcp 65001 >nul
echo ===================================================
echo 🚀 2027 考研政治 1000 题 · 本地免翻极速运行脚本
echo ===================================================
echo.
echo 正在启动本地做题服务，浏览器将自动弹出窗口...
echo 提示：关闭本黑框窗口即可停止本地服务。
echo.
start http://localhost:8080/
python -m http.server 8080
if %errorlevel% neq 0 (
  echo 启动失败，请检查是否安装了 Python。
  pause
)
