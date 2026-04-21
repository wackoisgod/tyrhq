-- Profiles table for user display names
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '' check (char_length(display_name) <= 32),
    updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Display names are public (needed for build creator attribution)
create policy "Public profiles are viewable by everyone"
    on public.profiles for select
    using (true);

-- Users can update only their own profile
create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id);

-- Users can insert their own profile (on-demand creation)
create policy "Users can insert own profile"
    on public.profiles for insert
    with check (auth.uid() = id);

-- Auto-create a profile row when a new user signs up (display_name left empty
-- so the app can redirect to settings for first-time onboarding)
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, display_name)
    values (new.id, '');
    return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Backfill profiles for existing users (must run before FK constraint)
insert into public.profiles (id, display_name)
select
    id,
    coalesce(
        raw_user_meta_data ->> 'full_name',
        raw_user_meta_data ->> 'name',
        split_part(email, '@', 1),
        ''
    )
from auth.users
on conflict (id) do nothing;

-- FK so Supabase PostgREST can join builds → profiles
alter table public.builds
    add constraint builds_profile_fk
    foreign key (user_id) references public.profiles(id);
