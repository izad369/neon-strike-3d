import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEON STRIKE 3D — Online & Offline FPS",
  description:
    "A fast neon 3D first-person shooter. Play offline vs bots or host/join peer-to-peer online matches. No server required — deploys anywhere as static files.",
  keywords: ["FPS", "3D game", "Three.js", "WebGL", "browser game", "multiplayer", "peer-to-peer"],
  authors: [{ name: "izad369" }],
  openGraph: {
    title: "NEON STRIKE 3D",
    description: "Neon arena FPS — play offline vs bots or online with friends via P2P.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" style={{ background: "#0a0a14", margin: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
