import { Hud } from "@/components/Hud";
import { AutoLpExperience } from "@/components/AutoLpExperience";
import "./autolp.css";
import "./orbit.css";

export const metadata = {
  title: "Automated LP",
  description: "Stock LP on autopilot: deposit ETH, earn Uniswap V4 trading fees on 8 tokenized stocks, rebalanced and compounded by on-chain rules.",
};

export default function AutoLpPage() {
  return <><Hud /><main className="ap-page"><AutoLpExperience /></main></>;
}
