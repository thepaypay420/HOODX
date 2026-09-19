"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { TokenArt } from "@/components/TokenArt";
import { FEATURED_VAULTS } from "@/lib/vaults";

function orbitPos(deg: number, radiusPct = 42) {
  const rad = ((deg - 90) * Math.PI) / 180;
  const x = 50 + radiusPct * Math.cos(rad);
  const y = 50 + radiusPct * Math.sin(rad);
  return { left: `${x}%`, top: `${y}%` };
}

export function ExploreConstellation({ fromHome = false }: { fromHome?: boolean }) {
  const [entering, setEntering] = useState(fromHome);

  useEffect(() => {
    if (!fromHome) return undefined;
    const t = window.setTimeout(() => setEntering(false), 900);
    return () => window.clearTimeout(t);
  }, [fromHome]);

  return (
    <section
      className={`explore-stage rise ${entering ? "explore-stage-entering" : ""}`}
      data-testid="explore-constellation"
    >
      <div className="explore-stage-glow" aria-hidden />
      <div className="landing-orbit landing-orbit-a explore-orbit" aria-hidden />
      <div className="landing-orbit landing-orbit-b explore-orbit" aria-hidden />

      {FEATURED_VAULTS.map((v, i) => {
        const pos = orbitPos(v.orbitDeg);
        return (
          <Link
            key={v.slug}
            href={`/i/${v.slug}`}
            data-testid={`explore-vault-${v.slug}`}
            className="explore-vault-orb"
            style={{
              ...pos,
              animationDelay: `${0.12 + i * 0.1}s`,
            }}
          >
            <span className="explore-vault-art">
              <TokenArt slug={v.slug} size="md" priority={i === 0} />
            </span>
            <span className="explore-vault-label">
              <span className="explore-vault-symbol">${v.symbol}</span>
              <span className="explore-vault-flair">{v.flair}</span>
            </span>
          </Link>
        );
      })}

      <Link href="/" className="explore-coin" data-testid="explore-home" aria-label="Back to HOODX home">
        <div className="landing-coin-rim" aria-hidden />
        <BrandMark size={96} priority className="landing-coin-mark" />
      </Link>

      <p className="explore-script">Pick your basket.</p>
    </section>
  );
}
