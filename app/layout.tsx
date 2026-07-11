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

export const metadata: Metadata = {
  title: "WikiRace Arena — speedrun the encyclopedia",
  description:
    "Race from one Wikipedia article to another using only links. Beat the ghost, then send friends a challenge link with your run inside it.",
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
