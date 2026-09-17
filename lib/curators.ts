export const CURATOR_696 = {
  handle: "696_eth",
  name: "696",
  x: "https://x.com/696_eth",
  tweet: "https://x.com/696_eth/status/2100067116594725086",
  avatar: "/curators/696_eth.jpg",
  followers: 12043,
  blurb: "CTO lead of @PrometheusGrok / Health & Wealth",
};

export const GEN0_SLUG = "696x";
export const GEN0_SYMBOL = "696X";
export const GEN0_NAME = "696x";

/** Optional. Public payout wallet for the “Give to 696” fee one-tap. Not a key. */
export const CURATOR_696_PAYOUT = (process.env.NEXT_PUBLIC_696_PAYOUT || "").trim();

/** Optional. Public curator wallet for “Hand book to 696”. They must Accept. Not a key. */
export const CURATOR_696_CURATOR = (process.env.NEXT_PUBLIC_696_CURATOR || "").trim();
