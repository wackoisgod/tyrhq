-- Playstyle notes: per-build (author intent, travels with shared builds) and
-- per-tank (personal notepad, private to each user).
--
-- Idempotent: an earlier revision of this migration (2000-char plain-text
-- notes, no notes_html) shipped to some databases before the markdown
-- upgrade. Re-running this file converges any state — fresh database, old
-- revision, or already migrated — to the same end state.

-- Author notes on builds. Markdown source plus server-sanitized HTML (same
-- pipeline as articles/guides — GFM, callouts, YouTube, live :stat refs).
-- Readable by whoever can read the build row, so creator intent shows up when
-- a shared build is opened. notes_html is derived server-side from notes on
-- every save; it is never accepted from the client.
alter table public.builds
    add column if not exists notes text not null default '';

alter table public.builds
    add column if not exists notes_html text not null default '';

-- (Re)apply the notes length limit — replaces the 2000-char check if the
-- earlier revision of this migration created it.
alter table public.builds drop constraint if exists builds_notes_check;
alter table public.builds
    add constraint builds_notes_check check (char_length(notes) <= 10000);

-- Personal per-tank notes. vehicle_id is a game-data identifier (validated
-- app-side against the vehicle catalog), not a foreign key.
create table if not exists public.tank_notes (
    user_id uuid references auth.users(id) on delete cascade not null,
    vehicle_id text not null,
    notes text not null default '' check (char_length(notes) <= 2000),
    updated_at timestamptz default now(),
    primary key (user_id, vehicle_id)
);

alter table public.tank_notes enable row level security;

-- Tank notes are private: owner-only for every operation
drop policy if exists "Users can view own tank notes" on public.tank_notes;
create policy "Users can view own tank notes"
    on public.tank_notes for select
    using (auth.uid() = user_id);

drop policy if exists "Users can create own tank notes" on public.tank_notes;
create policy "Users can create own tank notes"
    on public.tank_notes for insert
    with check (auth.uid() = user_id);

drop policy if exists "Users can update own tank notes" on public.tank_notes;
create policy "Users can update own tank notes"
    on public.tank_notes for update
    using (auth.uid() = user_id);

drop policy if exists "Users can delete own tank notes" on public.tank_notes;
create policy "Users can delete own tank notes"
    on public.tank_notes for delete
    using (auth.uid() = user_id);
