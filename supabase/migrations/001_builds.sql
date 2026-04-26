-- Builds table for saved/shared tank loadouts
create table public.builds (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade not null,
    slug text unique not null,
    title text not null default 'Untitled Build',
    vehicle_id text not null,
    selection jsonb not null,
    is_public boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Enable Row Level Security
alter table public.builds enable row level security;

-- Users can view their own builds
create policy "Users can view own builds"
    on public.builds for select
    using (auth.uid() = user_id);

-- Users can create builds
create policy "Users can create builds"
    on public.builds for insert
    with check (auth.uid() = user_id);

-- Users can update their own builds
create policy "Users can update own builds"
    on public.builds for update
    using (auth.uid() = user_id);

-- Users can delete their own builds
create policy "Users can delete own builds"
    on public.builds for delete
    using (auth.uid() = user_id);

-- Anyone can view public builds
create policy "Anyone can view public builds"
    on public.builds for select
    using (is_public = true);

-- Index for fast slug lookups
create index idx_builds_slug on public.builds (slug);

-- Index for user's builds list
create index idx_builds_user_id on public.builds (user_id, updated_at desc);
