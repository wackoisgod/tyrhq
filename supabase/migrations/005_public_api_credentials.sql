create table public.api_credentials (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users(id) on delete cascade,
    key_prefix text,
    key_hash text,
    status text not null default 'revoked' check (status in ('active', 'revoked')),
    created_at timestamptz not null default now(),
    rotated_at timestamptz,
    revoked_at timestamptz,
    last_used_at timestamptz,
    constraint api_credentials_active_requires_key
        check (status != 'active' or (key_prefix is not null and key_hash is not null))
);

alter table public.api_credentials enable row level security;

create table public.api_request_logs (
    id uuid primary key default gen_random_uuid(),
    api_credential_id uuid references public.api_credentials(id) on delete set null,
    credential_user_id uuid references auth.users(id) on delete set null,
    path text not null,
    method text not null,
    status_code integer not null,
    auth_status text not null
        check (auth_status in ('authenticated', 'missing', 'invalid', 'disabled', 'rate_limited', 'error')),
    ip text,
    user_agent text,
    created_at timestamptz not null default now()
);

alter table public.api_request_logs enable row level security;

create index idx_api_request_logs_credential_created_at
    on public.api_request_logs (api_credential_id, created_at desc);

create index idx_api_request_logs_ip_created_at
    on public.api_request_logs (ip, created_at desc);

create index idx_api_request_logs_created_at
    on public.api_request_logs (created_at desc);
