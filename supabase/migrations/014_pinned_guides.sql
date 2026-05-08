-- Editorial pinning for guides.
--
-- Pinned guides surface in the dedicated Pinned Guides block on /guides.
-- This is live-site metadata, not revisioned article body content, so it lives
-- only on public.articles.

alter table public.articles
    add column if not exists is_pinned boolean not null default false;

alter table public.articles
    drop constraint if exists articles_pinned_guides_only;

alter table public.articles
    add constraint articles_pinned_guides_only
    check (not is_pinned or type = 'guide');

create index if not exists idx_articles_pinned_guides
    on public.articles (published_at desc)
    where type = 'guide'
      and status = 'published'
      and is_pinned;
