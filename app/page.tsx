import type { ReactNode } from "react";
import Link from "next/link";
import { FeaturedIndex } from "@/components/FeaturedIndex";
import { Forge } from "@/components/Forge";
import { Gallery } from "@/components/Gallery";
import { Hud } from "@/components/Hud";
import { LiveIndexes } from "@/components/LiveIndexes";
import { Ticker } from "@/components/Ticker";
import { CREATOR_FEE_BPS, PROTOCOL_FEE_BPS } from "@/lib/config";

export default function Home() {
  const creatorPct = (CREATOR_FEE_BPS / 100).toFixed(2);
  const protocolPct = (PROTOCOL_FEE_BPS / 100).toFixed(2);

  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pb-28 sm:pt-16">
        <p className="text-[13px] text-[var(--dim)]">Robinhood Chain · on-chain index tokens</p>
        <h1 className="mt-3 max-w-[14ch] text-[2.5rem] font-semibold leading-[0.98] tracking-[-0.05em] sm:max-w-none sm:text-6xl">
          One token for a whole RH book
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-7 text-[var(--paper)] sm:text-[17px]">
          HOODX is a protocol for basket tokens on Robinhood Chain. Each index is an ERC-20 vault that holds
          2–24 Uni V3/V4 memecoin names plus a WETH cash sleeve. You send ETH to join and receive shares. You
          send shares back to leave and get your pro-rata ETH — always, even if the curator pauses new joins.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Why title="For holders">One click exposure to many RH names. NAV and every sleeve are visible on-chain.</Why>
          <Why title="For curators">
            Set target weights, rebalance the vault, earn {creatorPct}% on every join. Sliders + drift tools on each
            index page.
          </Why>
          <Why title="For creators">
            Mint your own slug at /i/yourslug, pick the pack, keep the fee cut. Redeem cannot be paused.
          </Why>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href={`/i/696x`} className="ape w-full px-6 text-[15px] sm:w-auto">
            Open 696X index
          </Link>
          <Link href="#create" className="ghost w-full px-6 sm:w-auto">
            Create your index
          </Link>
        </div>

        <Ticker />
        <FeaturedIndex />

        <section id="how" className="mt-16 grid gap-8 sm:grid-cols-3">
          <Step n="01" title="Pick names">
            Choose 2–24 RH tokens (V3 or V4). The vault holds them; you hold one share token.
          </Step>
          <Step n="02" title="Join with ETH">
            Deposit ETH → mint shares at live NAV. Fees: {creatorPct}% curator, {protocolPct}% protocol.
          </Step>
          <Step n="03" title="Leave anytime">
            Redeem shares → receive your slice of the vault in ETH. Curators rebalance; they cannot trap exits.
          </Step>
        </section>

        <section className="mt-14 rounded-2xl border border-[var(--line)] bg-[var(--line)]/20 p-5 sm:p-6">
          <p className="text-[13px] text-[var(--dim)]">What you are looking at</p>
          <p className="mt-2 max-w-2xl text-[15px] leading-7 text-[var(--dim)]">
            This is not a CEX basket or a copy-trade bot. It is a <span className="text-[var(--paper)]">smart-contract vault</span>{" "}
            on Robinhood Chain: transparent holdings, TWAP-priced swaps, a cash buffer for exits, and a public page at{" "}
            <span className="text-[var(--paper)]">/i/slug</span> for every index. 696X is the flagship book — capped
            sqrt-mcap weights from the 696 list.
          </p>
        </section>

        <div className="mt-16">
          <Forge />
        </div>

        <Gallery />
        <LiveIndexes />

        <p className="mt-16 text-[13px] leading-6 text-[var(--dim)]">
          NAV uses Uni V3 TWAP or V4 spot. 3% max slip per rebalance swap. Not financial advice. DYOR.
        </p>
      </main>
    </>
  );
}

function Why({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] px-4 py-3">
      <p className="text-[12px] font-medium text-[var(--cyan)]">{title}</p>
      <p className="mt-1.5 text-[14px] leading-6 text-[var(--dim)]">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="rise">
      <p className="text-[12px] text-[var(--dim)]">{n}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">{title}</h2>
      <p className="mt-2 text-[15px] leading-6 text-[var(--dim)]">{children}</p>
    </div>
  );
}
