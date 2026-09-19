import { EXPLORER, SAFE_696X_ADDR, VERIFIED_CONTRACTS } from "@/lib/config";

/** Site-wide trust strip — verification status, review scope, canonical vault. */
export function TrustNotice({ className = "" }: { className?: string }) {
  const vaultUrl = `${EXPLORER}/address/${SAFE_696X_ADDR}#code`;
  const factoryUrl = `${EXPLORER}/address/${VERIFIED_CONTRACTS[0].address}#code`;

  return (
    <div className={`trust-notice ${className}`}>
      <div className="trust-badges" aria-label="Security and verification status">
        <span className="trust-badge trust-badge-verified">Blockscout verified</span>
        <span className="trust-badge trust-badge-review">Cursor Grok 4.6 High review</span>
      </div>

      <p className="trust-line">
        Community project on Robinhood Chain — not Robinhood Markets, not tokenized HOOD stock.
      </p>

      <p className="trust-line">
        <strong className="trust-strong">No formal audit.</strong> All core contracts are source-verified on{" "}
        <a href={factoryUrl} target="_blank" rel="noreferrer" className="trust-link">
          Blockscout
        </a>{" "}
        (exact match):{" "}
        {VERIFIED_CONTRACTS.map((c, i) => (
          <span key={c.address}>
            {i > 0 ? ", " : ""}
            <a
              href={`${EXPLORER}/address/${c.address}#code`}
              target="_blank"
              rel="noreferrer"
              className="trust-link"
            >
              {c.label}
            </a>
          </span>
        ))}
        . Security &amp; economic review by <span className="trust-strong">Cursor Grok 4.6 High</span> — not a
        substitute for a formal audit.
      </p>

      <p className="trust-line trust-muted">
        Verify the{" "}
        <a href={vaultUrl} target="_blank" rel="noreferrer" className="trust-link">
          $696X vault
        </a>{" "}
        on Blockscout before you join. Never share a seed phrase.
      </p>
    </div>
  );
}
