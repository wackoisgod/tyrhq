-- Flyout assignment for guides and articles. A non-null flyout_section means
-- the article should appear under that heading in the Resources nav flyout.
-- Section names are validated at the application layer (Zod) against an enum
-- in src/lib/content/flyout-sections.ts so the set can grow without a DB
-- migration each time.

alter table public.articles
    add column if not exists flyout_section text null,
    add column if not exists flyout_order   integer null;

alter table public.article_submissions
    add column if not exists flyout_section text null,
    add column if not exists flyout_order   integer null;

create index if not exists articles_flyout_section_idx
    on public.articles (flyout_section, flyout_order)
    where flyout_section is not null and status = 'published';
