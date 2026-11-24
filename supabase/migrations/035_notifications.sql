-- In-app notifications. Players read their own rows and can mark them read.
-- Inserts are server-side only (service role). There is no insert or delete
-- policy, and authenticated has no insert grant.
-- This migration is not applied automatically.

create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    type text not null check (type ~ '^[a-z][a-z0-9_]{0,63}$'),
    title text not null check (char_length(title) between 1 and 140),
    body text not null check (char_length(body) between 1 and 2000),
    link text check (
        link is null
        or (
            char_length(link) between 1 and 500
            and link ~ '^/[^[:space:]]+$'
            and left(link, 2) <> '//'
            and position('://' in link) = 0
        )
    ),
    read_at timestamptz,
    created_at timestamptz not null default now()
);

create index idx_notifications_user_created
    on public.notifications (user_id, created_at desc);

create index idx_notifications_user_unread
    on public.notifications (user_id, created_at desc)
    where read_at is null;

alter table public.notifications enable row level security;

create policy "Users read own notifications"
    on public.notifications for select
    to authenticated
    using (auth.uid() = user_id);

create policy "Users update own notification read state"
    on public.notifications for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant select, insert, update, delete on table public.notifications to service_role;

-- Blocks client inserts and any update that changes more than read_at.
-- Runs as the invoker. Execute is revoked so it is not an API endpoint;
-- the trigger still fires because Postgres checks EXECUTE at create time.
create or replace function public.enforce_notification_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    jwt_role text := '';
    claims text;
begin
    claims := current_setting('request.jwt.claims', true);
    if claims is not null and left(btrim(claims), 1) = '{' then
        jwt_role := coalesce(claims::json->>'role', '');
    end if;

    if tg_op = 'INSERT' then
        if jwt_role = 'service_role'
           or current_user in ('service_role', 'postgres', 'supabase_admin') then
            return new;
        end if;
        raise exception 'notifications are created by the server';
    end if;

    if tg_op = 'UPDATE' then
        if jwt_role = 'service_role'
           or current_user in ('service_role', 'postgres', 'supabase_admin') then
            return new;
        end if;

        if new.id is distinct from old.id
           or new.user_id is distinct from old.user_id
           or new.type is distinct from old.type
           or new.title is distinct from old.title
           or new.body is distinct from old.body
           or new.link is distinct from old.link
           or new.created_at is distinct from old.created_at then
            raise exception 'only read state can be updated';
        end if;

        return new;
    end if;

    raise exception 'notifications cannot be removed here';
end;
$$;

revoke all on function public.enforce_notification_write() from public, anon, authenticated;

drop trigger if exists notifications_enforce_write on public.notifications;
create trigger notifications_enforce_write
    before insert or update on public.notifications
    for each row execute function public.enforce_notification_write();

comment on table public.notifications is 'Per-user notices. Players can read and mark their own rows. The server creates them.';
comment on column public.notifications.read_at is 'Null until the player marks the notice read.';
comment on column public.notifications.link is 'Site path only, such as /settings. Never an external URL.';
