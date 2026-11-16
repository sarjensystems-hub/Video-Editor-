import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";
import AuthHashHandler from "./AuthHashHandler";
import { BRAND } from "@/lib/brand";
import { appUrl } from "@/lib/app-url";

// Self-hosted (app/fonts, the latin subsets Google Fonts serves) rather
// than next/font/google, which downloads them during every build: when
// Google's response failed to parse, production builds failed with it.
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
});

const bricolage = localFont({
  src: "./fonts/bricolage-grotesque-latin.woff2",
  weight: "400 800",
  variable: "--font-bricolage",
});

const fraunces = localFont({
  src: [
    { path: "./fonts/fraunces-latin.woff2", weight: "300 500", style: "normal" },
    { path: "./fonts/fraunces-latin-italic.woff2", weight: "300 500", style: "italic" },
  ],
  variable: "--font-fraunces",
});

const SITE_URL = appUrl();

/**
 * There is no public site to optimise for, so this is the minimum a browser
 * needs: a tab title and a description. Every crawler is turned away in
 * robots.ts, which is why nothing here bothers with cards or canonicals.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.tagline,
  applicationName: BRAND.name,
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value ?? "light";

  return (
    <html lang="en" className={theme === "dark" ? "dark" : ""}>
      <body className={`${inter.variable} ${bricolage.variable} ${fraunces.variable} font-sans antialiased`}>
        <AuthHashHandler />
        {children}
      </body>
    </html>
  );
}
