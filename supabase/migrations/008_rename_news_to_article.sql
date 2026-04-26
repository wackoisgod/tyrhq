-- Rename the 'news' content type to 'article' so the database matches what
-- we call these on the public site (`/articles`). Splits the column rewrite
-- and the CHECK constraint swap into discrete steps so the order is safe
-- to re-run if interrupted.

-- 1. Drop the CHECK constraints so we can rewrite existing rows.
alter table public.articles
    drop constraint if exists articles_type_check;

alter table public.article_submissions
    drop constraint if exists article_submissions_type_check;

-- 2. Migrate existing rows.
update public.articles set type = 'article' where type = 'news';
update public.article_submissions set type = 'article' where type = 'news';

-- 3. Re-add the CHECK constraints with the new vocabulary.
alter table public.articles
    add constraint articles_type_check
    check (type in ('guide', 'article'));

alter table public.article_submissions
    add constraint article_submissions_type_check
    check (type in ('guide', 'article'));
