-- First-party OAuth 2.1 authorization server for the MCP endpoint.
--
-- Previously the protected-resource document pointed clients at Supabase Auth,
-- which does not implement Dynamic Client Registration. With no way to obtain a
-- client_id, ChatGPT fell back to asking the person connecting to supply one by
-- hand — which only the project owner could do, so nobody else could connect at
-- all. These tables let Studio issue client ids and tokens itself.

-- ── Clients ──────────────────────────────────────────────────────────────────
-- Registered dynamically by the MCP client (RFC 7591). Public clients only:
-- ChatGPT and Claude use PKCE and hold no usable secret, so none is stored.
create table if not exists public.mcp_oauth_clients (
  id             uuid primary key default gen_random_uuid(),
  client_id      text not null unique,
  client_name    text not null,
  redirect_uris  text[] not null,
  client_uri     text,
  logo_uri       text,
  created_at     timestamptz not null default now()
);

-- ── Authorization codes ──────────────────────────────────────────────────────
-- Short-lived and single-use. The code itself is stored hashed so a database
-- leak cannot be replayed at the token endpoint before it expires.
create table if not exists public.mcp_oauth_codes (
  id                    uuid primary key default gen_random_uuid(),
  code_hash             text not null unique,
  client_id             text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  scope                 text not null default 'mcp',
  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists mcp_oauth_codes_expires_idx on public.mcp_oauth_codes (expires_at);

-- ── Access tokens ────────────────────────────────────────────────────────────
-- Opaque, first-party, and stored hashed. This replaces handing a third party
-- the user's raw Supabase JWT, which carried their full database privileges and
-- could not be revoked without ending every one of their sessions.
create table if not exists public.mcp_access_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  client_id    text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  scope        text not null default 'mcp',
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists mcp_access_tokens_user_idx on public.mcp_access_tokens (user_id);

-- ── Row level security ───────────────────────────────────────────────────────
-- Every table is RLS-enabled with no permissive policy for the anon or
-- authenticated roles: only the service role touches these, through the server.
-- The one exception is a user reading and revoking their own tokens, which is
-- what the connected-apps screen needs.
alter table public.mcp_oauth_clients  enable row level security;
alter table public.mcp_oauth_codes    enable row level security;
alter table public.mcp_access_tokens  enable row level security;

drop policy if exists "own tokens are readable" on public.mcp_access_tokens;
create policy "own tokens are readable"
  on public.mcp_access_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "own tokens are revocable" on public.mcp_access_tokens;
create policy "own tokens are revocable"
  on public.mcp_access_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Housekeeping ─────────────────────────────────────────────────────────────
-- Consumed and expired codes have no value; keeping them only grows the table.
create or replace function public.purge_expired_mcp_oauth_codes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.mcp_oauth_codes
  where expires_at < now() - interval '1 day';
$$;
