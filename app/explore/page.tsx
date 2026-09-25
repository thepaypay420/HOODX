import Link from "next/link";
import { Hud } from "@/components/Hud";
import { LiveIndexes } from "@/components/LiveIndexes";
import { OfficialVaultDiscovery } from "@/components/OfficialVaultDiscovery";

export const metadata = { title: "Explore vaults", description: "Discover curated HOODX index vaults on Robinhood Chain." };
export default function ExplorePage() {
  return <><Hud /><main className="relative z-10"><section className="explore-editorial mx-auto max-w-5xl px-4 pb-7 pt-9 sm:px-6 sm:pb-9 sm:pt-12"><div className="rise"><p className="landing-eyebrow">Explore</p><h1>Find your basket.</h1><p>From internet culture to the companies shaping the physical world. Pick a thesis and hold it in one token.</p></div><Link href="/#create" className="landing-btn-secondary">Create your own <span aria-hidden>→</span></Link></section><div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6"><OfficialVaultDiscovery /><LiveIndexes /></div></main></>;
}
