-- Playstyle notes: per-build (author intent, travels with shared builds) and
-- per-tank (personal notepad, private to each user).

-- Author notes on builds. Readable by whoever can read the build row, so
-- creator intent shows up when a shared build is opened.
alter table public.builds
    add column notes text not null default '' check (char_length(notes) <= 2000);

-- Personal per-tank notes. vehicle_id is a game-data identifier (validated
-- app-side against the vehicle catalog), not a foreign key.
create table public.tank_notes (
    user_id uuid references auth.users(id) on delete cascade not null,
    vehicle_id text not null,
    notes text not null default '' check (char_length(notes) <= 2000),
    updated_at timestamptz default now(),
    primary key (user_id, vehicle_id)
);

alter table public.tank_notes enable row level security;

-- Tank notes are private: owner-only for every operation
create policy "Users can view own tank notes"
    on public.tank_notes for select
    using (auth.uid() = user_id);

create policy "Users can create own tank notes"
    on public.tank_notes for insert
    with check (auth.uid() = user_id);

create policy "Users can update own tank notes"
    on public.tank_notes for update
    using (auth.uid() = user_id);

create policy "Users can delete own tank notes"
    on public.tank_notes for delete
    using (auth.uid() = user_id);
