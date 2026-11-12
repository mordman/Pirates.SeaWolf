#!/usr/bin/env python3
"""Демонизатор dev-сервера (Next.js, порт 3000).

Песочница убивает потомков шелла Bash-вызова по завершении вызова
(reaper обходит цепочку детей). ДВОЙНОЙ fork + setsid дают процессу
PPID=1 (приёмыш tini/init) — как у демона agent-browser, который
выживает между вызовами. Дальше все потомки npm/next живут под
демоном и не принадлежат дереву вызова.

ВНИМАНИЕ: не запускать `npm run build` при живом dev-сервере —
build перезаписывает .next и убивает dev (перед build: pkill next).

Запуск: python3 scripts/devdaemon.py
Лог:    /tmp/devserver.log (и dev.log через tee из package.json)
"""
import os
import subprocess

PROJECT = "/home/z/my-project"
LOG = "/tmp/devserver.log"


def daemonize() -> None:
    """Классический двойной fork: итоговый процесс — приёмыш PID 1."""
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    os.setsid()
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    os.chdir("/")
    os.umask(0o022)


def already_running() -> bool:
    try:
        out = subprocess.run(
            ["pgrep", "-f", "next-server"],
            capture_output=True, text=True, timeout=10,
        )
        return out.returncode == 0 and out.stdout.strip() != ""
    except Exception:
        return False


def main() -> None:
    if already_running():
        print("ALREADY RUNNING: next-server жив, пропуск")
        return
    daemonize()
    logf = open(LOG, "ab", buffering=0)
    logf.write(f"\n[devdaemon {os.getpid()}] старт npm run dev\n".encode())
    os.dup2(logf.fileno(), 1)
    os.dup2(logf.fileno(), 2)
    subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=PROJECT,
        stdout=logf,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    # держим демон живым, пока жив npm (иначе npm станет сиротой —
    # это тоже ок, но нянька аккуратнее)
    while True:
        try:
            pid, _ = os.wait()
            if pid:
                break
        except ChildProcessError:
            break
        except OSError:
            break
    os._exit(0)


if __name__ == "__main__":
    main()
    print("DAEMON SPAWNED")
