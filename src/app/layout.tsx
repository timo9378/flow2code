import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flow2Code | Visual AST Compiler",
  description:
    "視覺化後端邏輯生成器：將畫布節點直接編譯為原生 TypeScript 代碼",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body className="antialiased bg-gray-950 text-white overflow-hidden">
        {children}
      </body>
    </html>
  );
}
