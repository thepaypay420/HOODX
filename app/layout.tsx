import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
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
  description: "Live on Robinhood Chain. One token. A whole book. DYOR.",
  applicationName: "HOODX",
  alternates: { canonical: "/" },
  openGraph: {
    title: "HOODX",
    description: "Live on Robinhood Chain. One token. A whole book.",
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
      <body className={`${ui.variable} ${mono.variable} antialiased`}>
        <Providers>
          <Aura />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
