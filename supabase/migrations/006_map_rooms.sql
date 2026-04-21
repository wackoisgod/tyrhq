create table public.map_rooms (
    id uuid primary key default gen_random_uuid(),
    map_slug text not null,
    host_user_id uuid references public.profiles(id) on delete cascade not null,
    title text not null default 'Live Room' check (char_length(title) <= 80),
    share_token text unique not null,
    state jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_activity_at timestamptz not null default now()
);

create table public.map_room_events (
    id bigint generated always as identity primary key,
    room_id uuid references public.map_rooms(id) on delete cascade not null,
    event_id text not null,
    actor_id text not null,
    actor_name text not null check (char_length(actor_name) <= 32),
    op_type text not null,
    payload jsonb not null,
    client_ts timestamptz,
    created_at timestamptz not null default now(),
    unique (room_id, event_id)
);

alter table public.map_rooms enable row level security;
alter table public.map_room_events enable row level security;

create policy "Hosts can view own map rooms"
    on public.map_rooms for select
    using (auth.uid() = host_user_id);

create policy "Hosts can create map rooms"
    on public.map_rooms for insert
    with check (auth.uid() = host_user_id);

create policy "Hosts can update own map rooms"
    on public.map_rooms for update
    using (auth.uid() = host_user_id);

create policy "Hosts can delete own map rooms"
    on public.map_rooms for delete
    using (auth.uid() = host_user_id);

create policy "Hosts can view own map room events"
    on public.map_room_events for select
    using (
        exists (
            select 1
            from public.map_rooms
            where public.map_rooms.id = public.map_room_events.room_id
              and public.map_rooms.host_user_id = auth.uid()
        )
    );

create index idx_map_rooms_share_token on public.map_rooms (share_token);
create index idx_map_rooms_host_user_id on public.map_rooms (host_user_id, updated_at desc);
create index idx_map_room_events_room_id on public.map_room_events (room_id, id asc);
