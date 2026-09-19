import { chromium, devices } from "playwright";
import { mkdir } from "node:fs/promises";

const base = "http://127.0.0.1:3100";
const out = "/tmp/hoodx/verify-screenshots";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function shot(name, context, path) {
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await page.close();
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await shot("explore-desktop-v2", desktop, "/explore");
await shot("explore-from-home-v2", desktop, "/explore?from=home");

const iphone = await browser.newContext({ ...devices["iPhone 13"] });
await shot("explore-mobile-v2", iphone, "/explore");

await desktop.close();
await iphone.close();
await browser.close();
console.log("saved", out);
