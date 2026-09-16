import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Oxanium, Syne } from "next/font/google";
import { Providers } from "./providers";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

const hud = Oxanium({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-hud",
});

const display = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "696X — build a meme index",
  description:
    "Build your own meme index. Share it. Earn a cut when friends ape in. $696X is Gen-0: the 696_eth Robinhood watchlist. DYOR.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "696X" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#03050c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${hud.variable} ${display.variable} ${mono.variable} antialiased`}>
        <div className="scan" aria-hidden />
        <Providers>
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
