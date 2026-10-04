/** A deposit or withdrawal prepared elsewhere (an AI assistant via the HOODX MCP server) arrives as ?deposit=0.05 or
 *  ?withdraw=25 on a vault page. Read once, validated, and only ever pre-fills the form: the user still reviews and signs. */
export type Intent = { deposit?: string; withdraw?: number };
export function readIntent(): Intent {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const d = q.get("deposit"), w = q.get("withdraw");
  if (d && /^\d{1,4}(\.\d{1,18})?$/.test(d) && Number(d) > 0) return { deposit: d };
  if (w && /^\d{1,3}$/.test(w) && Number(w) >= 1 && Number(w) <= 100) return { withdraw: Number(w) };
  return {};
}
export const INTENT_NOTE = "Prepared by your AI assistant. Check the amount, then confirm in your wallet.";
