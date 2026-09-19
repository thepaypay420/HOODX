#!/usr/bin/env python3
"""Submit Blockscout Standard JSON verification via Playwright (headed browser).

Human-paced flow: browse the contract page, open verification, pick comboboxes,
upload standard-input.json, submit once, then poll the Code tab (not the API).
"""

from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "verify-out"
STDJSON = OUT / "standard-input.json"
REPORT = json.loads((OUT / "report.json").read_text())
COMPILER = "v0.8.24+commit.e11b9ed9"

CONTRACTS = [
    c
    for c in REPORT["contracts"]
    if c["name"] in ("UniTwapOracle", "HoodxSwap", "HoodxIndex", "HoodxFactory")
]


def pause(lo: float = 2.0, hi: float = 5.0) -> None:
    time.sleep(random.uniform(lo, hi))


def dismiss_cookies(page) -> None:
    for label in ("Accept all", "Accept All", "Accept"):
        try:
            page.get_by_role("button", name=label).click(timeout=2000)
            pause(0.8, 1.5)
            return
        except Exception:
            pass
    page.evaluate(
        "() => { const el = document.getElementById('usercentrics-cmp-ui'); if (el) el.remove(); }"
    )


def code_tab_verified(page, address: str) -> bool:
    page.goto(
        f"https://robinhoodchain.blockscout.com/address/{address}#code",
        wait_until="domcontentloaded",
        timeout=120_000,
    )
    pause(5, 8)
    return "source code verified" in page.inner_text("body").lower()


def submit_one(page, spec: dict) -> dict:
    name = spec["name"]
    addr = spec["address"]
    print(f"\n=== {name} {addr} ===")

    if code_tab_verified(page, addr):
        print("already verified")
        return {"name": name, "address": addr, "status": "verified"}

    page.goto(
        f"https://robinhoodchain.blockscout.com/address/{addr}/contract-verification",
        wait_until="domcontentloaded",
        timeout=120_000,
    )
    pause(5, 8)
    dismiss_cookies(page)

    page.get_by_role("combobox").nth(1).click()
    pause(1, 2)
    page.get_by_role("option", name="Solidity (Standard JSON input)").click()
    pause(3, 5)

    page.get_by_role("combobox").nth(2).click()
    pause(1, 2)
    page.get_by_role("option", name=COMPILER).click()
    pause(2, 4)

    page.locator('input[name="sources"]').set_input_files(str(STDJSON))
    pause(3, 5)

    http_status = None

    def on_response(response) -> None:
        nonlocal http_status
        if "verification" in response.url:
            http_status = response.status

    page.on("response", on_response)
    page.get_by_role("button", name="Verify & publish").click()
    pause(10, 15)

    for _ in range(12):
        if code_tab_verified(page, addr):
            print("verified")
            return {"name": name, "address": addr, "status": "verified", "http": http_status}
        pause(6, 8)

    print(f"pending (http {http_status})")
    return {"name": name, "address": addr, "status": "pending", "http": http_status}


def main() -> int:
    from playwright.sync_api import sync_playwright

    results: list[dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=250)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto("https://robinhoodchain.blockscout.com", wait_until="domcontentloaded")
        pause(4, 6)
        dismiss_cookies(page)

        for i, spec in enumerate(CONTRACTS):
            if i:
                pause(30, 45)
            try:
                results.append(submit_one(page, spec))
            except Exception as exc:
                print(f"error: {exc}")
                results.append(
                    {
                        "name": spec["name"],
                        "address": spec["address"],
                        "status": "error",
                        "error": str(exc),
                    }
                )

        browser.close()

    (OUT / "browser-results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))
    return 0 if all(r["status"] == "verified" for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
