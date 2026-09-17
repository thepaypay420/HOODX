import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
import { Aura } from "@/components/Aura";
import { SiteFooter } from "@/components/SiteFooter";
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
  title: "HOODX",
  description: "Build a meme index. Share the link. Earn a cut. DYOR.",
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
