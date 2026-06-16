#!/usr/bin/env python3
import argparse
import os
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def log(message):
    print(message, flush=True)


def run(cmd, check=True, capture=False, cwd=ROOT):
    if capture:
        return subprocess.run(
            cmd,
            cwd=cwd,
            check=check,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    return subprocess.run(cmd, cwd=cwd, check=check)


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
    return result.returncode == 0, result.stdout.strip(), result.stderr.strip()


def show_status():
    ok, ps_out, ps_err = docker_compose_ps()
    if ok and ps_out:
        log("[docker] status:\n" + ps_out)
    elif ok:
        log("[docker] status: no containers")
    else:
        log("[docker] status unavailable")
        if ps_err:
            log(ps_err)


def main():
    parser = argparse.ArgumentParser(description="Control the docker compose stack")
    parser.add_argument("--no-build", action="store_true", help="Skip docker build")
    parser.add_argument("command", nargs="?", default="up", choices=["up", "down", "status", "restart"], help="Control command")
    args = parser.parse_args()

    if args.command == "status":
        show_status()
        return

    if args.command == "down":
        docker_compose_down()
        log("[done] stack stopped")
        return

    if args.command == "restart":
        docker_compose_down()
        time.sleep(0.5)

    ok, ps_out, _ps_err = docker_compose_ps()
    if ok and ps_out:
        log("[docker] current status:\n" + ps_out)

    try:
        docker_compose_up(build=not args.no_build)
    except FileNotFoundError:
        log("[error] docker command not found")
        sys.exit(1)
    log("[done] stack ready")


if __name__ == "__main__":
    main()
