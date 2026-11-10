import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/space-grotesk";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./globals.css";
import "./redesign.css";
import "./assistant.css";
import "./forge-theme.css";
import "./graphite-theme.css";
import "./overview-dashboard.css";
import "./readability.css";
import "./project-brief.css";
import "./priority-motion.css";
import "./calendar-events.css";

export const metadata: Metadata = {
  title: "Airly Forge Studio — Daylight workspace",
  description: "A focused home for projects, tasks, money, and content plans.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
