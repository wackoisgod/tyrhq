-- Captain-approved team membership requests.

create table public.team_join_requests (
    team_id uuid not null references public.teams(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
    requested_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.profiles(id) on delete set null,
    primary key (team_id, user_id)
);

create index idx_team_join_requests_pending
    on public.team_join_requests (team_id, requested_at)
    where status = 'pending';

alter table public.team_join_requests enable row level security;

create policy "Users can read own team join requests"
    on public.team_join_requests for select
    using (auth.uid() = user_id);

create policy "Captains can read team join requests"
    on public.team_join_requests for select
    using (
        exists (
            select 1 from public.teams
            where teams.id = team_id
              and teams.captain_id = auth.uid()
        )
    );
