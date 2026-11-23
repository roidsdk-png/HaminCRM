"""Continuously synchronize the authorized CRM projection into analytics."""

import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request(base, token, body=None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    operation = Request(
        base + "/api/internal/analysis/sync",
        data=payload,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="GET" if body is None else "POST",
    )
    with urlopen(operation, timeout=90) as response:
        return json.load(response)


def main():
    base = os.environ.get("ANALYTICS_CRM_URL", "http://127.0.0.1:3000").rstrip("/")
    token = os.environ.get("ANALYTICS_INTERNAL_TOKEN", "")
    if len(token) < 24:
        raise SystemExit("ANALYTICS_INTERNAL_TOKEN requires at least 24 characters.")
    interval = max(10, int(os.environ.get("ANALYTICS_SYNC_INTERVAL", "60")))
    checkpoint = None
    while True:
        try:
            if checkpoint is None:
                state = request(base, token)
                if state["needed"]:
                    checkpoint = {"mode": state["mode"]}
            while checkpoint is not None:
                page = request(base, token, checkpoint)
                if page["complete"]:
                    print(
                        f"Analytics synchronized {page['total']} changed records.",
                        flush=True,
                    )
                    checkpoint = None
                else:
                    checkpoint = {
                        "snapshotId": page["snapshotId"],
                        "cursor": page["nextCursor"],
                    }
        except HTTPError as error:
            print(
                f"Analytics sync request returned HTTP {error.code}. Retrying.",
                flush=True,
            )
            if error.code in {404, 409, 410}:
                checkpoint = None
        except (URLError, TimeoutError, OSError, ValueError, KeyError):
            print(
                "Analytics sync is waiting for the CRM and analytics service.",
                flush=True,
            )
        time.sleep(interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
