import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Рекламный кабинет",
  description: "Сводная аналитика и управление рекламными кампаниями по всем кабинетам.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full bg-page text-ink">{children}</body>
    </html>
  );
}
