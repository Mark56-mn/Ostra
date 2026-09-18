import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Ostra — AI control center",
  description:
    "Ostra v0: the communication layer for an experimental autonomous agent system. Talk to the Ostra model through a replaceable model adapter.",
  applicationName: "Ostra",
  openGraph: {
    title: "Ostra — AI control center",
    description: "Talk to the Ostra model. Prototype v0 of an experimental autonomous agent system.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#04060a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body className="min-h-[100dvh] bg-void-950 font-sans">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 ostra-grid opacity-70" />
          <div className="absolute inset-0 ostra-glow" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-void-950 to-transparent" />
        </div>
        {children}
      </body>
    </html>
  );
}
