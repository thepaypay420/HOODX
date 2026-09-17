"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { CURATOR_696, GEN0_SLUG } from "@/lib/curators";
import { loadTokenImage } from "@/lib/tokenImage";

const BOX = {
  xs: "h-5 w-5",
  sm: "h-10 w-10",
  md: "h-14 w-14 sm:h-20 sm:w-20",
} as const;

function Glyph({ slug, className }: { slug: string; className: string }) {
  const cells = useMemo(() => {
    let h = 2166136261;
    for (const ch of slug) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return Array.from({ length: 16 }, (_, i) => ((h >>> i) & 1) === 1);
  }, [slug]);
  return (
    <span className={`grid grid-cols-4 gap-px overflow-hidden rounded-[12px] border border-[var(--line)] p-0.5 ${className}`}>
      {cells.map((on, i) => (
        <span key={i} className={on ? "bg-[var(--mag)]" : "bg-white/5"} />
      ))}
    </span>
  );
}

export function TokenArt({
  slug,
  src,
  size = "md",
  alt,
  priority = false,
}: {
  slug: string;
  src?: string;
  size?: keyof typeof BOX;
  alt?: string;
  priority?: boolean;
}) {
  const stock = slug === GEN0_SLUG ? CURATOR_696.avatar : "";
  const [stored, setStored] = useState("");

  useEffect(() => {
    if (stock || src) return;
    setStored(loadTokenImage(slug));
  }, [slug, stock, src]);

  const url = src || stock || stored;
  const box = BOX[size];
  const label = alt || (slug === GEN0_SLUG ? `@${CURATOR_696.handle}` : `$${slug.toUpperCase()}`);

  if (!url) return <Glyph slug={slug || "index"} className={box} />;

  const remote = /^(data:|blob:|https?:)/i.test(url);
  return (
    <span
      data-testid="token-art"
      data-slug={slug}
      className={`relative block shrink-0 overflow-hidden rounded-full border border-[var(--line)] ${box}`}
    >
      {remote ? (
        // User uploads are data URLs; next/image does not host those.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <Image
          src={url}
          alt={label}
          width={400}
          height={400}
          priority={priority}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
