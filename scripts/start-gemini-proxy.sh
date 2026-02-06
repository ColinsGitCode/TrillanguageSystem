#!/bin/bash

# Gemini Host Proxy 后台启动脚本
# 作用：在宿主机上运行 Gemini CLI 代理，供 Docker 容器调用

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROXY_SCRIPT="$SCRIPT_DIR/gemini-host-proxy.js"
PID_FILE="/tmp/gemini-proxy.pid"
LOG_FILE="/tmp/gemini-proxy.log"

# 配置
export GEMINI_PROXY_PORT=3210
export GEMINI_PROXY_BIN="gemini"
export GEMINI_PROXY_TIMEOUT_MS=90000
# export GEMINI_PROXY_OUTPUT_DIR="/tmp/gemini-outputs"  # 可选：保存输出

case "$1" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "✅ Gemini Proxy 已在运行 (PID: $(cat "$PID_FILE"))"
      exit 0
    fi

    echo "🚀 启动 Gemini Host Proxy..."
    nohup node "$PROXY_SCRIPT" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"

    sleep 1
    if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "✅ Gemini Proxy 已启动"
      echo "   - PID: $(cat "$PID_FILE")"
      echo "   - Port: $GEMINI_PROXY_PORT"
      echo "   - Log: $LOG_FILE"
      echo ""
      echo "测试连接："
      curl -s http://localhost:$GEMINI_PROXY_PORT/health | jq .
    else
      echo "❌ 启动失败，查看日志："
      cat "$LOG_FILE"
      exit 1
    fi
    ;;

  stop)
    if [ ! -f "$PID_FILE" ]; then
      echo "⚠️  Gemini Proxy 未运行"
      exit 0
    fi

    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "🛑 停止 Gemini Proxy (PID: $PID)..."
      kill "$PID"
      rm -f "$PID_FILE"
      echo "✅ 已停止"
    else
      echo "⚠️  进程不存在，清理 PID 文件"
      rm -f "$PID_FILE"
    fi
    ;;

  restart)
    $0 stop
    sleep 1
    $0 start
    ;;

  status)
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      PID=$(cat "$PID_FILE")
      echo "✅ Gemini Proxy 运行中"
      echo "   - PID: $PID"
      echo "   - Port: $GEMINI_PROXY_PORT"
      echo "   - Log: $LOG_FILE"
      echo ""
      echo "健康检查："
      curl -s http://localhost:$GEMINI_PROXY_PORT/health | jq .
    else
      echo "❌ Gemini Proxy 未运行"
      [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
    fi
    ;;

  logs)
    if [ -f "$LOG_FILE" ]; then
      tail -f "$LOG_FILE"
    else
      echo "⚠️  日志文件不存在"
    fi
    ;;

  test)
    if [ -z "$2" ]; then
      echo "用法: $0 test \"your prompt\""
      exit 1
    fi

    echo "📡 测试 Gemini Proxy..."
    curl -X POST http://localhost:$GEMINI_PROXY_PORT/api/gemini \
      -H "Content-Type: application/json" \
      -d "{\"prompt\":\"$2\",\"baseName\":\"test\"}" | jq .
    ;;

  *)
    echo "Gemini Host Proxy 管理脚本"
    echo ""
    echo "用法: $0 {start|stop|restart|status|logs|test}"
    echo ""
    echo "命令："
    echo "  start    - 后台启动代理"
    echo "  stop     - 停止代理"
    echo "  restart  - 重启代理"
    echo "  status   - 查看状态"
    echo "  logs     - 查看实时日志"
    echo "  test     - 测试调用 (例: $0 test \"hello world\")"
    exit 1
    ;;
esac
