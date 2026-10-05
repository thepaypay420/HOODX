/* Watch rules as data: when each must fire, and which rules the guard must refuse because the user never said that number.
 * Run by watch.test.ts in CI and scripts/agent_unit.mjs locally. */
import type { WatchRule, WatchState } from "./watch";

const S = (over: Partial<WatchState> = {}): WatchState => ({ at: 0, ethUsd: 2700, boost: { target: 2, leverage: 2 }, positions: { autolp: { name: "Hands-free LP", valueUsd: 55 }, boost: { name: "Boosted ETH", valueUsd: 200 } }, ...over });

export const FIRE_CASES: { name: string; rule: WatchRule; state: WatchState; baseline?: number; fires: boolean }[] = [
  { name: "eth below, not yet", rule: { kind: "eth_price", op: "below", usd: 2500 }, state: S(), fires: false },
  { name: "eth below, crossed", rule: { kind: "eth_price", op: "below", usd: 2500 }, state: S({ ethUsd: 2490 }), fires: true },
  { name: "eth above, crossed", rule: { kind: "eth_price", op: "above", usd: 3000 }, state: S({ ethUsd: 3001 }), fires: true },
  { name: "boost steps aside, not yet", rule: { kind: "boost_event", event: "steps_aside" }, state: S(), fires: false },
  { name: "boost steps aside, yes", rule: { kind: "boost_event", event: "steps_aside" }, state: S({ boost: { target: 0, leverage: 0.02 } }), fires: true },
  { name: "boost leaves 2x", rule: { kind: "boost_event", event: "leaves_max" }, state: S({ boost: { target: 1.5, leverage: 1.6 } }), fires: true },
  { name: "boost any change, same", rule: { kind: "boost_event", event: "any_change" }, state: S(), baseline: 2, fires: false },
  { name: "boost any change, moved", rule: { kind: "boost_event", event: "any_change" }, state: S({ boost: { target: 1.75, leverage: 1.8 } }), baseline: 2, fires: true },
  { name: "leverage below 1x", rule: { kind: "boost_leverage", op: "below", x: 1 }, state: S({ boost: { target: 0.5, leverage: 0.6 } }), fires: true },
  { name: "position below value", rule: { kind: "position_value", vault: "autolp", op: "below", usd: 50 }, state: S({ positions: { autolp: { name: "Hands-free LP", valueUsd: 49 } } }), fires: true },
  { name: "position falls 10%, only 5%", rule: { kind: "position_change", vault: "boost", pct: -10 }, state: S({ positions: { boost: { name: "Boosted ETH", valueUsd: 190 } } }), baseline: 200, fires: false },
  { name: "position falls 10%, yes", rule: { kind: "position_change", vault: "boost", pct: -10 }, state: S({ positions: { boost: { name: "Boosted ETH", valueUsd: 179 } } }), baseline: 200, fires: true },
  { name: "no data, no alert", rule: { kind: "eth_price", op: "below", usd: 2500 }, state: S({ ethUsd: null }), fires: false },
];

export const WATCH_GUARD_CASES: { name: string; msgs: string[]; rule: WatchRule; ok: boolean; page?: string }[] = [
  { name: "price the user said", msgs: ["tell me if ETH drops below $2,500"], rule: { kind: "eth_price", op: "below", usd: 2500 }, ok: true },
  { name: "price the user did not say", msgs: ["tell me if ETH drops below $2,500"], rule: { kind: "eth_price", op: "below", usd: 2000 }, ok: false },
  { name: "leverage written as 1x", msgs: ["alert me if boost goes under 1x"], rule: { kind: "boost_leverage", op: "below", x: 1 }, ok: true },
  { name: "event needs no number", msgs: ["let me know if boost steps aside"], rule: { kind: "boost_event", event: "steps_aside" }, ok: true },
  { name: "position fall in percent", msgs: ["warn me if my hands free lp falls 10%"], rule: { kind: "position_change", vault: "autolp", pct: -10 }, ok: true },
  { name: "position on another vault", msgs: ["warn me if my hands free lp falls 10%"], rule: { kind: "position_change", vault: "boost", pct: -10 }, ok: false },
  { name: "position value on the page vault", msgs: ["tell me if this drops under $40"], page: "autolp", rule: { kind: "position_value", vault: "autolp", op: "below", usd: 40 }, ok: true },
];
