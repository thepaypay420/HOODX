"use client";

import { darkTheme, type DisclaimerComponent, type Theme } from "@rainbow-me/rainbowkit";

/** The wallet sheet in HOODX colours: the site's deep teal-black glass, one cyan accent, Outfit, soft edges. */
const base = darkTheme({ accentColor: "#1fd4c6", accentColorForeground: "#04110f", borderRadius: "large", overlayBlur: "small" });

export const HoodxWalletTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    modalBackground: "#0b1214",
    modalBorder: "rgba(238, 248, 246, 0.09)",
    modalBackdrop: "rgba(3, 7, 8, 0.66)",
    modalText: "#eef8f6",
    modalTextSecondary: "#8a9a97",
    modalTextDim: "rgba(138, 154, 151, 0.55)",
    menuItemBackground: "rgba(31, 212, 198, 0.08)",
    actionButtonBorder: "rgba(238, 248, 246, 0.08)",
    actionButtonBorderMobile: "rgba(238, 248, 246, 0.08)",
    actionButtonSecondaryBackground: "rgba(238, 248, 246, 0.06)",
    closeButton: "#8a9a97",
    closeButtonBackground: "rgba(238, 248, 246, 0.06)",
    generalBorder: "rgba(238, 248, 246, 0.08)",
    generalBorderDim: "rgba(238, 248, 246, 0.05)",
    selectedOptionBorder: "rgba(31, 212, 198, 0.4)",
    downloadTopCardBackground: "linear-gradient(160deg, rgba(31, 212, 198, 0.16), rgba(22, 32, 34, 0.9))",
    downloadBottomCardBackground: "linear-gradient(160deg, rgba(22, 32, 34, 0.9), #0b1214)",
    profileForeground: "#0b1214",
    profileAction: "rgba(238, 248, 246, 0.05)",
    profileActionHover: "rgba(31, 212, 198, 0.1)",
    connectionIndicator: "#1fd4c6",
    standby: "#e0b54a",
    error: "#ff7a6e",
  },
  fonts: { body: "var(--font-ui), system-ui, -apple-system, 'Segoe UI', sans-serif" },
  radii: { ...base.radii, modal: "26px", modalMobile: "28px", actionButton: "14px", menuButton: "14px" },
  shadows: {
    ...base.shadows,
    dialog: "0 30px 90px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(238, 248, 246, 0.04), 0 0 80px rgba(31, 212, 198, 0.06)",
    selectedOption: "0 0 0 1px rgba(31, 212, 198, 0.35)",
    selectedWallet: "0 0 0 1px rgba(31, 212, 198, 0.35)",
    walletLogo: "0 2px 12px rgba(0, 0, 0, 0.35)",
  },
};

/** One quiet line under the wallet list. */
export const WalletDisclaimer: DisclaimerComponent = ({ Text }) => <Text>HOODX never holds your keys. Your wallet approves every move.</Text>;
