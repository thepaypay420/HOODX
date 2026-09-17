"use client";

import { CATALOG } from "@/lib/catalog";

export function Ticker() {
  const names = CATALOG.map((c) => c.symbol).join("   ·   ");
  const line = `${names}   ·   ${names}`;
  return (
    <div className="ticker mt-10 border-y border-[var(--line)] py-2.5">
      <div className="ticker-track">
        <span>{line}</span>
        <span>{line}</span>
      </div>
    </div>
  );
}
