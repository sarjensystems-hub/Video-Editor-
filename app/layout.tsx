import type { Metadata } from "next";
import { Inter, Bricolage_Grotesque, Fraunces } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import AuthHashHandler from "./AuthHashHandler";
import { BRAND } from "@/lib/brand";
import { appUrl } from "@/lib/app-url";

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
