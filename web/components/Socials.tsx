import { GitHubMark } from "@/components/GitHubMark";
import { GITHUB_REPO, TELEGRAM } from "@/lib/config";

export function Socials({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <a
        href={TELEGRAM}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-11 w-11 items-center justify-center text-[var(--dim)] transition-colors hover:text-[var(--paper)]"
        aria-label="Telegram"
        data-testid="social-telegram"
      >
        <TelegramMark />
      </a>
      <a
        href={GITHUB_REPO}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-11 w-11 items-center justify-center text-[var(--dim)] transition-colors hover:text-[var(--paper)]"
        aria-label="GitHub"
      >
        <GitHubMark className="h-4 w-4" />
      </a>
    </div>
  );
}

function TelegramMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M21.9 4.3c.3-.9-.5-1.6-1.3-1.3L2.8 9.2c-.9.3-.9 1.6.1 1.9l4.6 1.5 1.8 5.6c.3.8 1.3 1 1.9.5l2.6-2.3 4.4 3.3c.7.5 1.7.1 1.9-.7l2.8-14.7ZM8.4 12.6l9.2-5.7-7.2 7.8-.3 2.3-1.7-4.4Z" />
    </svg>
  );
}
