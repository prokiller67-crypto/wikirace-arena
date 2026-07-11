import type { Metadata } from "next";
import { Archivo_Black, Spectral, Chivo_Mono } from "next/font/google";
import "./globals.css";

const display = Archivo_Black({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const body = Spectral({
  variable: "--font-body",
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const mono = Chivo_Mono({
  variable: "--font-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const TITLE = "WikiRace Arena — speedrun the encyclopedia";
const DESCRIPTION =
  "Race from one Wikipedia article to another using only links. Beat the ghost, race friends live, or send a challenge link with your run inside it.";

export const metadata: Metadata = {
  metadataBase: new URL("https://wikirace-arena.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://wikirace-arena.vercel.app",
    siteName: "WikiRace Arena",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
