-- Per-user provider API keys ("bring your own key").
--
-- One row per user. The key itself is never stored in plaintext: the server
-- encrypts it with AES-256-GCM before writing (see lib/user-secrets.ts), so a
-- database dump on its own does not hand anyone a working OpenRouter key —
-- the encryption key lives in the deployment's environment, not in Postgres.
--
-- `openrouter_key_last4` and `openrouter_key_set_at` exist so Settings can
-- show which key is configured without ever decrypting it, and without the
-- plaintext travelling back to the browser.

create table if not exists user_api_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  openrouter_key_cipher text,
  openrouter_key_last4 text,
  openrouter_key_set_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_api_keys enable row level security;

-- Owner-scoped like every other table. The ciphertext is readable by its owner
-- and useless without the server's encryption key, and the decrypt path runs
-- only on the server.
drop policy if exists "Users can manage their own API keys" on user_api_keys;
create policy "Users can manage their own API keys"
  on user_api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
