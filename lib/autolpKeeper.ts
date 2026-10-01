/** Pure decision logic for the hourly Automated LP keeper (Vercel Cron). Execution lives in the API route. */
export type SleeveStatus = { inRange: boolean; referenceAgrees: boolean; breachStart: bigint; rebandReady: boolean };

export type KeeperPlan = {
  /** Refresh breach timers (needed while any sleeve is out of range or has an open breach). */
  signal: boolean;
  /** Daily: realize and reinvest fees for every sleeve (00:00 UTC run). */
  compound: boolean;
  /** Weekly: push owed performance fees to the treasury (Monday 00:00 UTC run). */
  claim: boolean;
};

export function planKeeperRun(statuses: SleeveStatus[], now: Date): KeeperPlan {
  const hour = now.getUTCHours();
  return {
    signal: statuses.some((s) => !s.inRange || s.breachStart > 0n),
    compound: hour === 0,
    claim: hour === 0 && now.getUTCDay() === 1,
  };
}

/** Indices whose reband the contracts allow now (after the signal step has refreshed timers). */
export const readyRebands = (statuses: SleeveStatus[]) =>
  statuses.flatMap((s, i) => (s.rebandReady && s.referenceAgrees && !s.inRange ? [i] : []));
