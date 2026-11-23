"""Start the local CRM, private analytics API and incremental sync together."""

import os
import secrets
import shutil
import signal
import socket
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def local_environment():
    environment = os.environ.copy()
    config = ROOT / "analytics.env.local"
    if not config.exists():
        config.write_text(
            "ANALYTICS_INTERNAL_TOKEN=" + secrets.token_hex(32) + "\n"
            "ANALYTICS_SERVICE_URL=http://127.0.0.1:8091\n"
            "ANALYTICS_PROVIDER=openai\nANALYTICS_API_BASE_URL=\n"
            "ANALYTICS_API_KEY=\nANALYTICS_MODEL=\nANALYTICS_EMBEDDING_MODEL=\n",
            encoding="utf-8",
        )
    for line in config.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        environment[name.strip()] = value.strip().strip('"').strip("'")
    environment["ANALYTICS_ENV"] = "development"
    environment["WRANGLER_SEND_METRICS"] = "false"
    environment["WRANGLER_WRITE_LOGS"] = "false"
    environment.setdefault("ANALYTICS_CRM_URL", "http://localhost:3143")
    variables = ROOT / ".dev.vars"
    lines = (
        variables.read_text(encoding="utf-8-sig").splitlines()
        if variables.exists()
        else []
    )
    owned = {"ANALYTICS_INTERNAL_TOKEN", "ANALYTICS_SERVICE_URL"}
    lines = [line for line in lines if line.split("=", 1)[0].strip() not in owned]
    lines.extend(name + "=" + environment[name] for name in sorted(owned))
    variables.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return environment


def main():
    environment = local_environment()
    for host, port in (("127.0.0.1", 8091), ("localhost", 3143)):
        try:
            with socket.create_connection((host, port), timeout=0.5):
                raise SystemExit(
                    f"Local port {port} is already in use. Stop the previous local preview before restarting."
                )
        except OSError:
            pass
    python = (
        ROOT
        / ".venv-analytics"
        / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    if not python.is_file():
        raise SystemExit(
            "Create .venv-analytics and install analytics/requirements.txt first."
        )
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    node = shutil.which("node")
    if not npm or not node:
        raise SystemExit("Node and npm are required to start the local CRM.")
    # Migrations are explicitly local and use the same persistence as Vinext.
    migration = subprocess.run(
        [
            npm,
            "exec",
            "--",
            "wrangler",
            "d1",
            "migrations",
            "apply",
            "DB",
            "--local",
            "--config",
            "wrangler.local.jsonc",
        ],
        cwd=ROOT,
        check=False,
        env={**environment, "CI": "true"},
    )
    if migration.returncode:
        raise SystemExit(migration.returncode)
    options = {"cwd": ROOT, "env": environment}
    if os.name == "nt":
        options["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        )
    children = []
    commands = [
        [
            str(python),
            "-m",
            "uvicorn",
            "analytics.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8091",
        ],
        [
            node,
            str(ROOT / "node_modules" / "vinext" / "dist" / "cli.js"),
            "dev",
            "--hostname",
            "localhost",
            "--port",
            "3143",
        ],
        [str(python), "-u", str(ROOT / "scripts" / "analysis-sync.py")],
    ]
    try:
        for command in commands:
            children.append(subprocess.Popen(command, **options))
        print("Local analysis preview: http://localhost:3143/analysis", flush=True)
        print(
            "Model providers: /analysis > source settings (owner only). Environment fallback: analytics.env.local",
            flush=True,
        )
        while True:
            for child in children:
                result = child.poll()
                if result is not None:
                    raise SystemExit(result or 1)
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for child in reversed(children):
            if child.poll() is not None:
                continue
            if os.name == "nt":
                stopped = subprocess.run(
                    ["taskkill", "/PID", str(child.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                if stopped.returncode and child.poll() is None:
                    print(
                        f"Local child process {child.pid} could not be stopped automatically.",
                        flush=True,
                    )
            else:
                child.send_signal(signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()


if __name__ == "__main__":
    main()
