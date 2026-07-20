import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const googleAnalyticsId = "G-EZVEJ0RCVT";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://x424.org"),
  title: "x424 — Human Dependency Protocol",
  description:
    "x424 makes unique humanity a native HTTP dependency—for users, agents, and APIs.",
  openGraph: {
    title: "x424 — Human Dependency Protocol",
    description:
      "x424 makes unique humanity a native HTTP dependency—for users, agents, and APIs.",
    type: "website",
    url: "https://x424.org",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "x424 — Human Dependency Protocol",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "x424 — Human Dependency Protocol",
    description:
      "x424 makes unique humanity a native HTTP dependency—for users, agents, and APIs.",
    images: ["/og.png"],
  },
  alternates: {
    canonical: "https://x424.org",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`}
        />
        <script
          id="google-analytics"
          dangerouslySetInnerHTML={{
            __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${googleAnalyticsId}');
          `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
