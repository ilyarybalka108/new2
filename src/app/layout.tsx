import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TasteDigger — рекомендации по вкусу с объяснениями",
  description:
    "Укажите любимую музыку, фильмы и книги — получите портрет вкуса и находки с объяснением связей: лейблы, сцены, эпохи, настроения.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
