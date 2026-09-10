import type { Metadata } from "next";
import { Inter, Bricolage_Grotesque, Fraunces } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import AuthHashHandler from "./AuthHashHandler";
import { BRAND } from "@/lib/brand";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  weight: ["400", "500", "600", "700", "800"],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["300", "400", "500"],
  style: ["italic", "normal"],
});

const configuredSiteUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
const SITE_URL = configuredSiteUrl && configuredSiteUrl.length > 0 ? configuredSiteUrl : "https://studio.example.com";

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
