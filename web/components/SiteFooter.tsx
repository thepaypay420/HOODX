import { BrandMark } from "@/components/BrandMark";
import { Socials } from "@/components/Socials";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pb-12 pt-4 sm:px-6">
      <p className="inline-flex items-center gap-2 text-[13px] font-medium tracking-[-0.03em] text-[var(--dim)]">
        <BrandMark size={22} />
        HOODX
      </p>
      <Socials />
    </footer>
  );
}
