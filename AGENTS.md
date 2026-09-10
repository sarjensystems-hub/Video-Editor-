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
  and every account bypasses charging, because this deployment bills the
  company's own OpenRouter and Vercel accounts directly.
- The shape is kept so real limits can be reintroduced by editing that one
  file. Do not wire in a payment provider without being asked.

## Row-level security

- Every table is owner-scoped through RLS. Do not disable it, and do not reach
  around it with the service-role key for work a user-scoped client can do.
