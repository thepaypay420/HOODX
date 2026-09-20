import { productionV2Factory } from "@/lib/v2";

/** Compact footer disclaimer — verification & review notes only. */
export function TrustNotice({ className = "" }: { className?: string }) {
  const blockscout = `https://repo.sourcify.dev/4663/${productionV2Factory}`;
  return (
    <p className={`trust-notice ${className}`}>
      Community project — not Robinhood Markets. Core contracts{" "}
      <a href={blockscout} target="_blank" rel="noreferrer" className="trust-link">
        source verification
      </a>
      ; no formal audit.
    </p>
  );
}
