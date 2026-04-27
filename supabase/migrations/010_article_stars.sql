-- Stars/upvotes for published articles and guides.

create table public.article_stars (
    user_id uuid references auth.users(id) on delete cascade not null,
    article_id uuid references public.articles(id) on delete cascade not null,
    created_at timestamptz not null default now(),
    primary key (user_id, article_id)
);

alter table public.article_stars enable row level security;

create policy "Article stars are publicly readable"
    on public.article_stars for select
    using (true);

create policy "Users can star published articles"
    on public.article_stars for insert
    with check (
        auth.uid() = user_id
        and exists (
            select 1 from public.articles
            where id = article_id
              and status = 'published'
              and author_user_id is distinct from auth.uid()
        )
    );

create policy "Users can unstar own article stars"
    on public.article_stars for delete
    using (auth.uid() = user_id);

create index idx_article_stars_article_id
    on public.article_stars (article_id);

alter table public.articles
    add column if not exists star_count integer not null default 0;

create or replace function public.update_article_star_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if (TG_OP = 'INSERT') then
        update public.articles
        set star_count = star_count + 1
        where id = NEW.article_id;
        return NEW;
    elsif (TG_OP = 'DELETE') then
        update public.articles
        set star_count = star_count - 1
        where id = OLD.article_id;
        return OLD;
    end if;
    return null;
end;
$$;

create trigger on_article_star_change
    after insert or delete on public.article_stars
    for each row execute function public.update_article_star_count();
