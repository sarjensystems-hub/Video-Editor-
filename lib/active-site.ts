/**
 * Active site utility
 *
 * Reads the active_site_id cookie set when the user switches sites in the sidebar.
 * Used by every server page and action to scope queries to the correct site.
 */
import { cookies } from "next/headers";

export async function getActiveSiteId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("active_site_id")?.value ?? null;
}
