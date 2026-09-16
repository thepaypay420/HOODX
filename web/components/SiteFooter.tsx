import { GitHubMark } from "@/components/GitHubMark";
import { GITHUB_REPO } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pb-10 pt-2 sm:px-5">
      <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-[var(--dim)]">
        HOODX
      </p>
      <a
        href={GITHUB_REPO}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-2 text-[13px] text-[var(--dim)] hover:text-[var(--paper)]"
      >
        <GitHubMark />
        GitHub
      </a>
    </footer>
  );
}
