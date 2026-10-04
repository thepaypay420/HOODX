"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AutoLpCard } from "@/components/AutoLpCard";
import { BoostCard } from "@/components/BoostCard";

/** The two flagship vaults, live, as they appear on Explore. Old "/#create" links land on the Create page. */
export function HomeFeatured() {
  useEffect(() => { if (window.location.hash === "#create") window.location.replace("/create"); }, []);
  return (
    <section id="explore" className="home-featured scroll-mt-24 border-t border-[var(--line)] pt-12 sm:pt-16">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="landing-eyebrow">Flagship vaults</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Deposit ETH. Let it work.</h2>
        </div>
        <Link href="/explore?from=home" className="ghost px-4 text-[13px]">
          All strategies →
        </Link>
      </div>
      <div className="discovery-leads">
        <BoostCard />
        <AutoLpCard />
      </div>
    </section>
  );
}
