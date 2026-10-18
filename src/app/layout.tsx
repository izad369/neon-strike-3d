import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DESERT STRIKE 3D — Online & Offline Military FPS",
  description:
    "A fast desert-military 3D first-person shooter. Play offline vs bots or host/join peer-to-peer online matches. No server required — deploys anywhere as static files.",
  keywords: ["FPS", "3D game", "Three.js", "WebGL", "browser game", "multiplayer", "peer-to-peer", "military"],
  authors: [{ name: "izad369" }],
  openGraph: {
    title: "DESERT STRIKE 3D",
    description: "Desert military arena FPS — play offline vs bots or online with friends via P2P.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#171410",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" style={{ background: "#171410", margin: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
