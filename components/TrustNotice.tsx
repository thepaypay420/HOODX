import { EXPLORER, SAFE_696X_ADDR } from "@/lib/config";

/** Short site-wide disclaimer — not official Robinhood, verify canonical vault. */
export function TrustNotice({ className = "" }: { className?: string }) {
  const vaultUrl = `${EXPLORER}/address/${SAFE_696X_ADDR}`;
  return (
    <p className={`text-[11px] leading-5 text-[var(--dim)] ${className}`}>
      Community project on Robinhood Chain — not Robinhood Markets, not tokenized HOOD stock, not audited.
      Verify the vault on{" "}
      <a href={vaultUrl} target="_blank" rel="noreferrer" className="text-[var(--paper)] underline-offset-2 hover:underline">
        Blockscout
      </a>{" "}
      before you join. Never share a seed phrase.
    </p>
  );
}
