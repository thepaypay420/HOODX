import { Hud } from "@/components/Hud";
import { IndexClient } from "@/components/IndexClient";
import { Starfield } from "@/components/Starfield";
import { GEN0_SLUG } from "@/lib/curators";

export default async function IndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clean = slug.toLowerCase();
  const gen0 = clean === GEN0_SLUG;
  return (
    <>
      <Starfield />
      <Hud />
      <IndexClient slug={clean} gen0={gen0} />
    </>
  );
}
