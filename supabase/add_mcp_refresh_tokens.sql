-- ── Refresh tokens for the MCP authorization server ─────────────────────────
--
-- The original grant issued a 30-day access token and nothing else, so every
-- connection died permanently on day 30 and every user had to re-authorise by
-- hand. There was no way for a client to renew silently.
--
-- Additive and safe to run on a live table: every column is nullable, and the
-- server treats a row with no refresh hash as a legacy access-token-only grant
-- that still works until it expires.

alter table public.mcp_access_tokens
  add column if not exists refresh_token_hash  text,
  add column if not exists refresh_expires_at  timestamptz,
  add column if not exists refresh_used_at     timestamptz,
  -- Every token rotated from the same original grant shares a chain id, so
  -- revoking a compromised family is one statement rather than walking a list.
  add column if not exists chain_id            uuid,
  add column if not exists rotated_from        uuid references public.mcp_access_tokens(id) on delete set null;

-- A refresh token must resolve to exactly one row.
create unique index if not exists mcp_access_tokens_refresh_hash_idx
  on public.mcp_access_tokens (refresh_token_hash)
  where refresh_token_hash is not null;

create index if not exists mcp_access_tokens_chain_idx
  on public.mcp_access_tokens (chain_id)
  where chain_id is not null;

-- Existing grants become their own single-member chain so the reuse-detection
-- query has something consistent to revoke.
update public.mcp_access_tokens
   set chain_id = id
 where chain_id is null;
