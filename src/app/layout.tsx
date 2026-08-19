import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Poppins } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: {
    default: "Yarnhub",
    template: "%s · Yarnhub",
  },
  description:
    "SMS organising tools for unions and campaigns — inbox, blasts, P2P, surveys, and relays.",
};

export const viewport: Viewport = {
  themeColor: "#e81c1c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} ${inter.className} h-full`}
    >
      <body className="flex min-h-full flex-col antialiased">
        {children}
        <Toaster theme="light" richColors />
      </body>
    </html>
  );
}
