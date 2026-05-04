-- Patch notes / change logs as a third article type.
--
-- We reuse the existing `articles` and `article_submissions` tables (and the
-- whole upload/review/publish pipeline) by adding `'patch'` to the type
-- vocabulary and a single nullable `version` column for display (e.g. v0.5.2).
--
-- Mirrors the safe-rerun shape of 008_rename_news_to_article.sql so the
-- constraint swap is idempotent.

----------------------------------------------------------------------
-- 1. Drop the CHECK constraints so we can extend the vocabulary.
----------------------------------------------------------------------

alter table public.articles
    drop constraint if exists articles_type_check;

alter table public.article_submissions
    drop constraint if exists article_submissions_type_check;

----------------------------------------------------------------------
-- 2. Add the version column. Nullable: legacy rows have no version,
--    and articles/guides won't ever set one.
----------------------------------------------------------------------

alter table public.articles
    add column if not exists version text;

alter table public.article_submissions
    add column if not exists version text;

----------------------------------------------------------------------
-- 3. Re-add the CHECK constraints with 'patch' added.
----------------------------------------------------------------------

alter table public.articles
    add constraint articles_type_check
    check (type in ('guide', 'article', 'patch'));

alter table public.article_submissions
    add constraint article_submissions_type_check
    check (type in ('guide', 'article', 'patch'));
