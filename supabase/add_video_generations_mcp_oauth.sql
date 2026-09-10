-- Extend the canonical user video history so MCP requests can reserve an
-- idempotent job before the paid provider submission and keep OAuth-user
-- generations in the same table as browser generations.

alter table public.video_generations
  alter column openrouter_job_id drop not null;

alter table public.video_generations
  add column if not exists mcp_idempotency_key text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists mode text,
  add column if not exists credits_refunded_at timestamptz;

update public.video_generations
set
  provider = coalesce(provider, 'openrouter'),
  model = coalesce(model, 'bytedance/seedance-2.0-fast'),
  mode = coalesce(mode, 'cinematic')
where provider is null or model is null or mode is null;

alter table public.video_generations
  alter column provider set default 'openrouter',
  alter column model set default 'bytedance/seedance-2.0-fast',
  alter column mode set default 'cinematic';

create unique index if not exists video_generations_user_mcp_idempotency_uidx
  on public.video_generations (user_id, mcp_idempotency_key)
  where mcp_idempotency_key is not null;
