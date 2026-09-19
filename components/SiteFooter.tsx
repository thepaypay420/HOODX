import { BrandMark } from "@/components/BrandMark";
import { Socials } from "@/components/Socials";
import { TrustNotice } from "@/components/TrustNotice";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto max-w-5xl px-4 pb-12 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-[13px] font-medium tracking-[-0.03em] text-[var(--dim)]">
          <BrandMark size={22} />
          HOODX
        </p>
        <Socials />
      </div>
      <TrustNotice className="mt-4 max-w-3xl" />
    </footer>
  );
}
