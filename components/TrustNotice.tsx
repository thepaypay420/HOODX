import { EXPLORER, LIVE_FACTORY_ADDR } from "@/lib/config";

/** Compact footer disclaimer — verification & review notes only. */
export function TrustNotice({ className = "" }: { className?: string }) {
  const blockscout = `${EXPLORER}/address/${LIVE_FACTORY_ADDR}#code`;
  return (
    <p className={`trust-notice ${className}`}>
      Community project — not Robinhood Markets. Core contracts{" "}
      <a href={blockscout} target="_blank" rel="noreferrer" className="trust-link">
        verified on Blockscout
      </a>
      ; Cursor Grok 4.6 High review; no formal audit.
    </p>
  );
}
