"use client";

import type { ReactNode } from "react";
import { Companion } from "@/components/agent/Companion";
import { WalletProvider } from "@/lib/wallet";

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}<Companion /></WalletProvider>;
}
