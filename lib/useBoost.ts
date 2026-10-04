"use client";

import { useEffect, useState } from "react";
import type { BoostStats } from "@/app/api/boost-stats/route";

/** Polls the cached Boosted ETH stats (the CDN absorbs traffic; the chain is read at most once a minute). */
export function useBoostStats(pollMs = 60_000) {
  const [stats, setStats] = useState<BoostStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/boost-stats").then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: BoostStats) => { if (alive) { setStats(d); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const id = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);
  return { stats, failed };
}
