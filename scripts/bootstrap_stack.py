#!/usr/bin/env python3
import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOG_DIR = os.path.join(ROOT, "logs")
PROXY_LOG = os.path.join(LOG_DIR, "gemini-proxy.log")
PID_FILE = os.path.join(LOG_DIR, "gemini-proxy.pid")
PROXY_PORT = int(os.environ.get("GEMINI_PROXY_PORT", "3210"))
PROXY_URL = os.environ.get("GEMINI_PROXY_URL", f"http://localhost:{PROXY_PORT}/health")
PROXY_CMD = ["node", os.path.join(ROOT, "scripts", "gemini-host-proxy.js")]


def log(msg):
    print(msg, flush=True)


def run(cmd, check=True, capture=False, cwd=ROOT):
    if capture:
        return subprocess.run(cmd, cwd=cwd, check=check, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return subprocess.run(cmd, cwd=cwd, check=check)


def http_get(url, timeout=2):
    try:
        req = Request(url, method="GET")
        with urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8")
    except (HTTPError, URLError, socket.timeout) as exc:
        return None, str(exc)


def is_proxy_healthy():
    status, body = http_get(PROXY_URL, timeout=2)
    if status != 200:
        return False
    try:
        data = json.loads(body)
        return data.get("status") == "ok"
    except Exception:
        return False


def read_pid():
    if not os.path.exists(PID_FILE):
        return None
    try:
        with open(PID_FILE, "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except Exception:
        return None


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def start_proxy():
    os.makedirs(LOG_DIR, exist_ok=True)
    log(f"[proxy] starting: {' '.join(PROXY_CMD)}")
    with open(PROXY_LOG, "a", encoding="utf-8") as logf:
        proc = subprocess.Popen(
            PROXY_CMD,
            cwd=ROOT,
            stdout=logf,
            stderr=logf,
            start_new_session=True
        )
    with open(PID_FILE, "w", encoding="utf-8") as f:
        f.write(str(proc.pid))

    # wait for health
    for _ in range(20):
        if is_proxy_healthy():
            log("[proxy] healthy")
            return True
        time.sleep(0.5)
    log("[proxy] failed to become healthy; check logs")
    return False


def ensure_proxy():
    if is_proxy_healthy():
        log("[proxy] already healthy")
        return True

    pid = read_pid()
    if pid and pid_alive(pid):
        log(f"[proxy] pid {pid} running but unhealthy, restarting")
        try:
            os.killpg(pid, signal.SIGTERM)
        except Exception:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
        time.sleep(0.5)

    return start_proxy()


def docker_compose_up(build=True):
    cmd = ["docker", "compose", "up", "-d"]
    if build:
        cmd.append("--build")
    log(f"[docker] {' '.join(cmd)}")
    run(cmd, check=True)

def docker_compose_down():
    cmd = ["docker", "compose", "down"]
    log(f"[docker] {' '.join(cmd)}")
    run(cmd, check=True)


def docker_compose_ps():
    cmd = ["docker", "compose", "ps"]
    result = run(cmd, check=False, capture=True)
    return result.returncode == 0, result.stdout.strip()

def stop_proxy():
    pid = read_pid()
    if not pid:
        log("[proxy] no pid file, nothing to stop")
        return
    if not pid_alive(pid):
        log("[proxy] pid not alive, cleanup pid file")
        try:
            os.remove(PID_FILE)
        except Exception:
            pass
        return
    log(f"[proxy] stopping pid {pid}")
    try:
        os.killpg(pid, signal.SIGTERM)
    except Exception:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
    time.sleep(0.5)
    if not pid_alive(pid):
        try:
            os.remove(PID_FILE)
        except Exception:
            pass

def show_status():
    proxy_ok = is_proxy_healthy()
    pid = read_pid()
    pid_info = f"pid={pid}" if pid else "pid=none"
    log(f"[proxy] status={'ok' if proxy_ok else 'down'} {pid_info}")
    ok, ps_out = docker_compose_ps()
    if ok and ps_out:
        log("[docker] status:\n" + ps_out)
    elif ok:
        log("[docker] status: no containers")
    else:
        log("[docker] status: unavailable")


def main():
    parser = argparse.ArgumentParser(description="Bootstrap host proxy + docker stack")
    parser.add_argument("--no-build", action="store_true", help="Skip docker build")
    parser.add_argument("command", nargs="?", default="up", choices=["up", "down", "status", "restart"], help="Control command")
    args = parser.parse_args()

    if args.command == "status":
        show_status()
        return

    if args.command == "down":
        docker_compose_down()
        stop_proxy()
        log("[done] stack stopped")
        return

    if args.command == "restart":
        docker_compose_down()
        stop_proxy()
        time.sleep(0.5)

    log("[check] verifying gemini proxy")
    if not ensure_proxy():
        log("[error] proxy startup failed")
        sys.exit(1)

    ok, ps_out = docker_compose_ps()
    if ok and ps_out:
        log("[docker] current status:\n" + ps_out)

    docker_compose_up(build=not args.no_build)
    log("[done] stack ready")


if __name__ == "__main__":
    main()
