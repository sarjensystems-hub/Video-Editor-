# Database setup

Run these files **in this order** in the Supabase SQL editor
(Dashboard → SQL Editor → New query → paste → Run). Order matters: later files
reference tables the earlier ones create.

1. `sites.sql` — workspaces. Everything else hangs off a site.
2. `add_creative_studio.sql` — the core four tables: projects, revisions,
   assets and render jobs.
3. `add_creative_folders.sql` — folders in the Creative Studio file browser.
4. `add_video_generations.sql` — generated-video jobs.
5. `add_video_generations_audio.sql` — adds the audio flag to the above.
6. `add_mcp_oauth.sql` — the three tables that let ChatGPT and Claude sign in.
7. `add_mcp_refresh_tokens.sql` — keeps those connections alive past an hour.
8. `add_video_generations_mcp_oauth.sql` — lets video jobs be started over MCP.
9. `add_storage_buckets.sql` — the two Supabase Storage buckets this
   deployment uses in place of Cloudflare R2: `article-images` for media, and
   `creative-render-snapshots` for the render-cache metadata.

Every file is safe to re-run: they all use `if not exists`, so a partial run can
simply be repeated from the top.

## What is not here

The upstream product metered usage and charged credits. None of that survives in
this deployment, so there are no `user_credits`, `credit_transactions` or
`dodo_orders` tables and no `deduct_credits` / `add_credits` functions. Two
columns named `credits_charged` and `credits_refunded_at` remain on the render
and video job tables because the read paths still select them by name; they stay
at their defaults and nothing ever writes them.

## Row-level security

Every table has RLS switched on with owner-scoped policies, so one signed-in
user can never read another's projects. That holds even with a single shared
account, and it is what makes adding a second person later a non-event — do not
disable it.
