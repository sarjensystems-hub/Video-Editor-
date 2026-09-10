/**
 * Every piece of product identity lives here.
 *
 * The name below is a placeholder. To rebrand the whole deployment, change the
 * values in this file and then rename the MCP tool identifiers, which are
 * protocol strings rather than display text and so are written literally
 * throughout the codebase and its tests:
 *
 *     grep -rl 'studio_' --exclude-dir=node_modules . \
 *       | xargs sed -i 's/studio_/<newprefix>_/g'
 *
 * The prefix must stay a valid identifier — lowercase letters and underscores,
 * no spaces or hyphens — because it forms the tool names an LLM sees when it
 * connects. Keep `toolPrefix` below in step with whatever you sed to, so the
 * two never drift.
 */

export const BRAND = {
  /** Shown in the browser tab, the sidebar and every page title. */
  name: "Studio",

  /** One line under the name. Keep it short; it appears in page metadata. */
  tagline: "Direct real video from chat",

  /**
   * Prefix on every MCP tool name, e.g. `studio_render_creative_project`.
   * This is what an LLM sees in its tool list, so it is the single most
   * visible piece of branding in the whole product.
   */
  toolPrefix: "studio",

  /** Named in the MCP server handshake and shown by some connector UIs. */
  mcpServerName: "studio-media-mcp",
} as const;
