# Repository agent rules

## Before you push

- `npm test` and `npx tsc --noEmit` both have to pass. `npm run build` runs
  them for you via `prebuild`, so a green build means both are green.
- A push to `main` deploys straight to production. There is no staging gate, so
  verify locally first.

## Vercel billing safety

- Never add, invite, or modify Vercel team members or collaborators — as part
  of deployment, authentication, debugging or production recovery. Paid seats
  are billable, and adding a person is never the fix for a deployment problem.
- Any membership change needs the account owner to approve it explicitly, in
  the conversation, before it is made.

## Branding

- Product identity lives in `lib/brand.ts`. Change it there, never inline.
- The MCP tool names (`studio_*`) are protocol strings, written literally
  across the code and its tests. `lib/brand.ts` documents the one command that
  renames them; keep `BRAND.toolPrefix` in step with whatever they say.

## Billing is off

- Nothing meters or charges. `lib/credit-costs.ts` returns zero for everything
  and every account bypasses charging: each user's generation is billed to
  their own OpenRouter key, and hosting is a flat Vercel fee.
- The shape is kept so real limits can be reintroduced by editing that one
  file. Do not wire in a payment provider without being asked.

## Keys belong to users

- Generation runs on the signed-in account's own OpenRouter key, resolved
  per request through `lib/openrouter-key.ts`. There is no deployment-wide
  key and no fallback: reintroducing one puts the deployment owner back on
  the hook for everyone's generation, and a guard test fails if any file so
  much as names `OPENROUTER_API_KEY`.
- A new route that can reach OpenRouter must be wrapped in
  `withOpenRouterKeyScope` (or, for MCP, run inside `withUserOpenRouterKey`),
  or it will fall through to that fallback.

## Addresses come from the request

- `lib/app-url.ts` answers "where does this deployment live". Per-request code
  uses `requestOrigin()`, which is right on every domain the app answers on;
  only build-time metadata falls back to the environment. Do not reintroduce a
  placeholder host — the old one shipped inside the MCP URL users were told to
  paste into ChatGPT.

## Storage

- Files live in one private Tigris bucket (`lib/b2.ts`, configured by
  `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY`, `TIGRIS_BUCKET`,
  optional `TIGRIS_ENDPOINT`). Backblaze B2 (`B2_*`) is the earlier provider
  and only a fallback when Tigris is not configured. Supabase holds the
  database and sign-in only; do not put files back in Supabase Storage - its
  free plan refuses anything over 50 MB, and a guard test fails on
  `.storage.from(`.
- No card is on file anywhere. Tigris's free plan allows 5 GB stored, 10,000
  writes and 100,000 reads a month, and interrupts service past them rather
  than billing. Downloads themselves are free. Keep request counts low.
- A file's stored URL is `/media/<path>` on the app's own domain, which
  redirects to a short-lived signed storage URL. Never store a storage URL
  itself; that is what made moving providers a pure copy.
- Browser uploads go straight to storage as multipart uploads with per-part
  signed URLs; nothing passes through a Vercel function, so there is no size
  cap. The bucket's CORS rule allows GET, PUT and HEAD from the app's three
  addresses; a new domain needs adding to it (PutBucketCors, or the Tigris
  console).
- Company networks behind a firewall must allow `*.storage.dev` for uploads
  and playback.
- Every file lives under `<userId>/<kind>/…`, built only by
  `lib/storage-paths.ts`; a guard test fails on a hand-built path, and deletes
  refuse any path outside the caller's own folder.
- Storage requests are capped, and Backblaze's free plan capped downloads at
  1 GB a day, so renders must not re-read media per frame. `lib/creative/sandbox-media.ts` copies a
  render's media into the sandbox once, and previews and draft renders read a
  large video's small stored preview copy (`metadata.preview_url`, made on
  first use). The final MP4 always reads originals.
- Preview frames are never stored. They are rendered in memory and returned
  inline as WebP (`lib/mcp-server/inline-images.ts`).
- Anything that deletes a project deletes its files too, through
  `deleteUserFiles`, keeping any file a surviving row still references.
- The Media page (`/dashboard/media`, `lib/media-library.ts`) lists the user's
  storage folder itself, not the database, so it also shows files nothing uses.
  Deleting there removes the describing rows first, then the file, and refuses
  any file a project timeline still places. Any new delete button must remove
  the stored file as well, never just the row.

## No workspaces

- There are no workspaces. Projects, assets, folders, renders and videos
  belong to their owner and are listed by `user_id` alone. The old "sites"
  system scoped them by a per-browser cookie, which hid work from anyone on a
  different browser; do not bring back a per-browser scope.

## Row-level security

- Every table is owner-scoped through RLS. Do not disable it, and do not reach
  around it with the service-role key for work a user-scoped client can do.
