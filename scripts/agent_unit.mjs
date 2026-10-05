// Runs the agent's deterministic test cases (lib/agent/guardCases.ts, watchCases.ts) with plain Node, for machines whose
// Node is too old for vitest. Transpiles the agent's pure files with the project's TypeScript into node_modules/.cache.
// Usage: node scripts/agent_unit.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const out = path.resolve("node_modules/.cache/agent-unit");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "package.json"), '{"type":"commonjs"}');
execFileSync(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "lib/agent/understand.ts", "lib/agent/guard.ts", "lib/agent/guardCases.ts", "lib/agent/watch.ts", "lib/agent/watchCases.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
const req = createRequire(import.meta.url);
const { checkDeposit, checkWithdraw, checkWatch } = req(path.join(out, "guard.js"));
const { GUARD_CASES, TEST_VAULTS } = req(path.join(out, "guardCases.js"));
const { evaluate } = req(path.join(out, "watch.js"));
const { FIRE_CASES, WATCH_GUARD_CASES } = req(path.join(out, "watchCases.js"));

let fail = 0;
for (const c of GUARD_CASES) {
  const r = c.kind === "deposit" ? checkDeposit(c.intent, c.msgs, TEST_VAULTS, c.page) : checkWithdraw(c.intent, c.msgs, TEST_VAULTS, c.page);
  const good = c.expect === "clarify" ? r.decision === "clarify" : JSON.stringify(r) === JSON.stringify(c.expect);
  if (!good) fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${c.name}${good ? "" : `\n      got ${JSON.stringify(r)}\n      want ${JSON.stringify(c.expect)}`}`);
}
console.log(`\n${GUARD_CASES.length - fail}/${GUARD_CASES.length} guard cases pass`);

let wfail = 0;
for (const c of FIRE_CASES) { const got = evaluate(c.rule, c.state, c.baseline) !== null; if (got !== c.fires) { wfail++; console.log(`FAIL  watch fires: ${c.name} (got ${got})`); } }
for (const c of WATCH_GUARD_CASES) { const got = checkWatch(c.rule, c.msgs, TEST_VAULTS, c.page).decision === "ok"; if (got !== c.ok) { wfail++; console.log(`FAIL  watch guard: ${c.name} (got ${got})`); } }
const n = FIRE_CASES.length + WATCH_GUARD_CASES.length;
console.log(`${n - wfail}/${n} watch cases pass`);
process.exit(fail + wfail ? 1 : 0);
