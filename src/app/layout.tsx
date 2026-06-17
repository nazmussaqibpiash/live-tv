import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider, themeNoFlashScript } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ToastHost } from "@/components/toast-host";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Live TV — Watch 12,000+ Channels Free",
  description:
    "Premium web Live TV: thousands of auto-maintained BDIX & international channels with seamless source failover. Works on mobile, desktop, and TV browsers.",
  applicationName: "Live TV",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Live TV",
  },
  openGraph: {
    title: "Live TV — Watch 12,000+ Channels Free",
    description:
      "Premium web Live TV with seamless source failover. Mobile, desktop & TV ready.",
    type: "website",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      <body className="min-h-full" suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
        <ToastHost />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
