import type { Metadata, Viewport } from "next";
import { Caveat, IBM_Plex_Mono, Outfit } from "next/font/google";
import { Aura } from "@/components/Aura";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_URL } from "@/lib/config";
import { Providers } from "./providers";
import "./globals.css";

const ui = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
});

const script = Caveat({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-script",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "HOODX",
    template: "%s · HOODX",
  },
  description:
    "Community index factory on Robinhood Chain — not Robinhood Markets. No formal audit; core contracts verified on Blockscout. Security & economic review by Cursor Grok 4.6 High. One token for a curated RH-chain basket with a WETH cash sleeve.",
  applicationName: "HOODX",
  alternates: { canonical: "/" },
  openGraph: {
    title: "HOODX",
    description:
      "Community index on Robinhood Chain. Core contracts verified on Blockscout. No formal audit — Cursor Grok 4.6 High security & economic review.",
    url: SITE_URL,
    siteName: "HOODX",
    type: "website",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "HOODX" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${ui.variable} ${script.variable} ${mono.variable} antialiased`}>
        <Providers>
          <Aura />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
