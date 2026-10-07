import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEON STRIKE 3D",
  description: "Fast installable 3D browser game shell with offline-ready caching.",
  keywords: ["3D game", "Three.js", "WebGL", "browser game", "offline"],
  authors: [{ name: "izad369" }],
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "NEON STRIKE 3D",
    description: "Installable offline-ready 3D browser game.",
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
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" style={{ background: "#0a0a14", margin: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
