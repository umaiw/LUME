import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import StatusBanner from "@/components/StatusBanner";
import ErrorBoundary from "@/components/ErrorBoundary";
import OnlineStatus from "@/components/OnlineStatus";

export const metadata: Metadata = {
  title: "L U M E",
  applicationName: "L U M E",
  description: "L U M E - private messages and privacy by default",
  keywords: ["messenger", "secure", "encrypted", "anonymous", "e2ee", "lume"],
  authors: [{ name: "Lume Team" }],
  icons: {
    icon: "/lume-icon.png",
    shortcut: "/lume-icon.png",
    apple: "/lume-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f5" },
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased min-h-screen">
        <script
          nonce={nonce}
          suppressHydrationWarning
          // Set theme before React hydration to avoid a flash.
          dangerouslySetInnerHTML={{
            __html: `
(() => {
  try {
    const key = 'lume-theme';
    const stored = localStorage.getItem(key);
    const theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();
            `.trim(),
          }}
        />
        <div className="min-h-screen flex flex-col">
          <OnlineStatus />
          <ErrorBoundary>
            <StatusBanner />
            <div className="flex-1 min-h-0">{children}</div>
          </ErrorBoundary>
        </div>
      </body>
    </html>
  );
}
