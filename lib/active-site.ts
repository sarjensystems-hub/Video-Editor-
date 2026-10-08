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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The PostgREST filter that scopes a list to the active workspace.
 *
 * Rows with no workspace belong to every workspace. Projects the assistant
 * creates over the connector have none (a connector request carries no
 * browser cookie), and neither does anything made in a browser that never
 * picked one - so filtering on the workspace alone hid them from anyone
 * whose own browser had one selected.
 *
 * The id comes from a cookie, so it is checked to be a UUID before it goes
 * anywhere near a filter string.
 */
export function workspaceScopeFilter(siteId: string | null): string | null {
  if (!siteId || !UUID.test(siteId)) return null;
  return `site_id.eq.${siteId},site_id.is.null`;
}
