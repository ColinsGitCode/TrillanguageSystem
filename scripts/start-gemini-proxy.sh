#!/bin/bash

# Gemini Host Proxy 后台启动脚本
# 作用：在宿主机上运行 Gemini CLI 代理，供 Docker 容器调用

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROXY_SCRIPT="$SCRIPT_DIR/gemini-host-proxy.js"
PID_FILE="/tmp/gemini-proxy.pid"
LOG_FILE="/tmp/gemini-proxy.log"
RUNTIME_DIR="$PROJECT_ROOT/.runtime/gemini"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"
GEMINI_BIN_DEFAULT="${GEMINI_PROXY_BIN:-$(command -v gemini 2>/dev/null || true)}"

if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN="/opt/homebrew/bin/node"
fi
if [ -z "$NODE_BIN" ] && [ -x /usr/local/bin/node ]; then
  NODE_BIN="/usr/local/bin/node"
fi

if [ -z "$GEMINI_BIN_DEFAULT" ] && [ -x /opt/homebrew/bin/gemini ]; then
  GEMINI_BIN_DEFAULT="/opt/homebrew/bin/gemini"
fi
if [ -z "$GEMINI_BIN_DEFAULT" ] && [ -x /usr/local/bin/gemini ]; then
  GEMINI_BIN_DEFAULT="/usr/local/bin/gemini"
fi

# 配置
export GEMINI_PROXY_PORT=3210
export GEMINI_PROXY_BIN="${GEMINI_BIN_DEFAULT:-gemini}"
export GEMINI_PROXY_TIMEOUT_MS=150000
export GEMINI_PROXY_MODEL="${GEMINI_PROXY_MODEL:-gemini-3-pro-preview}"
export GEMINI_PROXY_HOME="${GEMINI_PROXY_HOME:-$RUNTIME_DIR}"
export GEMINI_SETTINGS_PATH="${GEMINI_SETTINGS_PATH:-$RUNTIME_DIR/settings.json}"
# export GEMINI_PROXY_OUTPUT_DIR="/tmp/gemini-outputs"  # 可选：保存输出

mkdir -p "$RUNTIME_DIR"

if [ -z "$NODE_BIN" ]; then
  echo "❌ 未找到 node 可执行文件，请设置 NODE_BIN 或安装 Node.js"
  exit 1
fi

case "$1" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "✅ Gemini Proxy 已在运行 (PID: $(cat "$PID_FILE"))"
      exit 0
    fi

    echo "🚀 启动 Gemini Host Proxy..."
    nohup "$NODE_BIN" "$PROXY_SCRIPT" > "$LOG_FILE" 2>&1 &
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

  reset)
    echo "♻️  请求 Gemini Proxy 执行 reset..."
    curl -s -X POST http://localhost:$GEMINI_PROXY_PORT/admin/reset | jq .
    ;;

  *)
    echo "Gemini Host Proxy 管理脚本"
    echo ""
    echo "用法: $0 {start|stop|restart|status|logs|test|reset}"
    echo ""
    echo "命令："
    echo "  start    - 后台启动代理"
    echo "  stop     - 停止代理"
    echo "  restart  - 重启代理"
    echo "  status   - 查看状态"
    echo "  logs     - 查看实时日志"
    echo "  test     - 测试调用 (例: $0 test \"hello world\")"
    echo "  reset    - 重置并清理正在执行的 Gemini CLI 子进程"
    exit 1
    ;;
esac
