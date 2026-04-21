-- Junction table for build stars (likes/upvotes)
create table public.build_stars (
    user_id  uuid references auth.users(id) on delete cascade not null,
    build_id uuid references public.builds(id) on delete cascade not null,
    created_at timestamptz default now(),
    primary key (user_id, build_id)
);

alter table public.build_stars enable row level security;

-- Anyone can see stars (needed to display counts)
create policy "Stars are publicly readable"
    on public.build_stars for select
    using (true);

-- Authenticated users can star public builds (not their own)
create policy "Users can star public builds"
    on public.build_stars for insert
    with check (
        auth.uid() = user_id
        and exists (
            select 1 from public.builds
            where id = build_id
              and is_public = true
              and user_id != auth.uid()
        )
    );

-- Users can remove their own stars
create policy "Users can unstar"
    on public.build_stars for delete
    using (auth.uid() = user_id);

-- Index for fast star count lookups per build
create index idx_build_stars_build_id on public.build_stars (build_id);

-- Denormalized star count on builds for fast reads
alter table public.builds add column star_count integer not null default 0;

-- Trigger function to keep star_count in sync
create or replace function public.update_build_star_count()
returns trigger as $$
begin
    if (TG_OP = 'INSERT') then
        update public.builds set star_count = star_count + 1 where id = NEW.build_id;
        return NEW;
    elsif (TG_OP = 'DELETE') then
        update public.builds set star_count = star_count - 1 where id = OLD.build_id;
        return OLD;
    end if;
    return null;
end;
$$ language plpgsql security definer;

create trigger on_build_star_change
    after insert or delete on public.build_stars
    for each row execute function public.update_build_star_count();
