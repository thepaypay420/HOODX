import { Hud } from "@/components/Hud";
import { BoostExperience } from "@/components/BoostExperience";
import "../autolp/autolp.css";
import "./boost.css";

export const metadata = {
  title: "Boosted ETH",
  description: "Smart ETH leverage on Robinhood Chain: up to 2x ETH while crypto trends up, dollars earning yield when the trend breaks. Every move computed on-chain.",
};

export default function BoostPage() {
  return <><Hud /><main className="ap-page bx-page"><BoostExperience /></main></>;
}
