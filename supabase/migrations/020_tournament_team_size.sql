alter table public.tournaments
    add column if not exists team_size integer not null default 8 check (team_size = 8),
    add column if not exists substitute_count integer not null default 1 check (substitute_count >= 0 and substitute_count <= 16);

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
            and table_name = 'tournaments'
            and column_name = 'roster_max'
    ) then
        update public.tournaments
        set
            team_size = 8,
            substitute_count = greatest(0, least(16, coalesce(roster_max, 9) - 8));
    end if;
end $$;
