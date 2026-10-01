import { assetLogo } from "@/lib/assetLogos";

/** Overlapping holding chips for Explore cards: the asset's saved logo, or its full ticker when none is reviewed. */
export function AssetChips({ assets, max = 6 }: { assets: readonly string[]; max?: number }) {
  const shown = assets.slice(0, max);
  return <div className="discovery-tokens" aria-label={`${assets.length} assets: ${assets.join(", ")}`}>
    {shown.map((asset) => {
      const src = assetLogo(asset);
      // eslint-disable-next-line @next/next/no-img-element -- 128px static WebP, content-hashed and immutable-cached; next/image adds nothing here
      return src ? <b key={asset} title={asset}><img src={src} alt={asset} width={64} height={64} loading="lazy" decoding="async" /></b>
        : <b key={asset} className="is-text" title={asset}>{asset}</b>;
    })}
    {assets.length > max && <b className="is-more">+{assets.length - max}</b>}
  </div>;
}
