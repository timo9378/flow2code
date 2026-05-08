import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flow2Code | X-ray Vision for Backend Code",
  description:
    "Decompile TypeScript into visual flows, edit on canvas, export clean zero-dependency code",
  metadataBase: new URL("https://flow2code.koimsurai.com"),
  openGraph: {
    title: "Flow2Code — X-ray Vision for Backend Code",
    description:
      "Paste any TypeScript API route → see it as a visual flow → edit on canvas → export clean code. Zero runtime dependency.",
    url: "https://flow2code.koimsurai.com",
    siteName: "Flow2Code",
    type: "website",
    images: [
      {
        url: "/OG.png",
        width: 1869,
        height: 954,
        alt: "Flow2Code — Decompile TypeScript into visual flows",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Flow2Code — X-ray Vision for Backend Code",
    description:
      "Paste any TypeScript API route → see it as a visual flow → edit on canvas → export clean code.",
    images: ["/OG.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased overflow-hidden">
        <TooltipProvider delayDuration={200}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
