import { GitHubMark } from "@/components/GitHubMark";
import { GITHUB_REPO } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 pb-10 pt-2">
      <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--dim)]">
        HOODX · DYOR
      </p>
      <a
        href={GITHUB_REPO}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--dim)] hover:text-[var(--cyan)]"
      >
        <GitHubMark />
        GitHub
      </a>
    </footer>
  );
}
