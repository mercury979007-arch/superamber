#!/bin/bash
cd "$(dirname "$0")"
echo "正在启动 Super Amber demo 服务..."
PORT=8765
# 检查端口
if lsof -i :$PORT > /dev/null 2>&1; then
  echo "端口 $PORT 已被占用，尝试使用 8766..."
  PORT=8766
fi
echo "访问地址：http://localhost:$PORT"
echo "（按 Ctrl+C 停止）"
open "http://localhost:$PORT"
python3 -m http.server $PORT --directory "$(dirname "$0")/dist"
