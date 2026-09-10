import type { MetadataRoute } from "next";

/**
 * An internal tool has nothing to gain from being indexed, and the whole app
 * sits behind a login, so every crawler is turned away at the door.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
