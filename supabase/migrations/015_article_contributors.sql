-- Multi-contributor credit for articles.
--
-- Before this migration, an article's authorship was tracked by a single
-- author_user_id on public.articles. Suggested edits flowed through
-- article_submissions but the submitter's identity was lost at publish time:
-- article_revisions.created_by stored the reviewer who approved, not the
-- contributor who actually wrote the change.
--
-- This adds:
--   1. submitter_user_id + submitter_display columns on article_revisions
--      so each revision carries the contributor that wrote it.
--   2. A backfill from article_submissions via source_submission_id.
--   3. A public-read RLS policy on article_revisions scoped to revisions of
--      already-published articles — so the per-article history page can be
--      browsed by anyone (like Google Docs revision history).
--   4. A view public.article_contributors that lists distinct contributors
--      per article, excluding the article's own author (self-edits are not
--      a separate "contribution" — they're already credited via the byline).

----------------------------------------------------------------------
-- 1. New columns on article_revisions
----------------------------------------------------------------------

alter table public.article_revisions
    add column if not exists submitter_user_id uuid
    references public.profiles(id) on delete set null;

alter table public.article_revisions
    add column if not exists submitter_display text
    check (submitter_display is null or char_length(submitter_display) <= 80);

create index if not exists idx_article_revisions_submitter
    on public.article_revisions (submitter_user_id, created_at desc)
    where submitter_user_id is not null;

----------------------------------------------------------------------
-- 2. Backfill from submissions
----------------------------------------------------------------------

update public.article_revisions r
set
    submitter_user_id = s.submitter_id,
    submitter_display = coalesce(p.display_name, r.author_display)
from public.article_submissions s
left join public.profiles p on p.id = s.submitter_id
where r.source_submission_id = s.id
  and r.submitter_user_id is null;

----------------------------------------------------------------------
-- 3. Public-read RLS for revisions of published articles
----------------------------------------------------------------------

-- Drop the old reviewer-only-read policy so anyone can browse revision
-- history. Reviewers retain access via the new policy (it covers them too).
drop policy if exists "Reviewers can read all revisions" on public.article_revisions;

create policy "Revisions of published articles are publicly readable"
    on public.article_revisions for select
    using (
        exists (
            select 1 from public.articles a
            where a.id = article_revisions.article_id
              and a.status = 'published'
        )
    );

-- Reviewers and admins keep full visibility (drafts, withdrawn, etc.) so
-- the admin tools can show history for unpublished rows.
create policy "Reviewers can read all revisions"
    on public.article_revisions for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

----------------------------------------------------------------------
-- 4. Contributors view
----------------------------------------------------------------------

-- One row per (article, distinct contributor) excluding the article's own
-- author. display_name is resolved live from profiles when available, falling
-- back to the snapshot taken at publish time so deleted profiles still render
-- the credit they had.

create or replace view public.article_contributors as
select
    r.article_id,
    r.submitter_user_id as user_id,
    coalesce(nullif(trim(p.display_name), ''), r.submitter_display) as display_name,
    count(*)::int as contribution_count,
    min(r.created_at) as first_contributed_at,
    max(r.created_at) as last_contributed_at
from public.article_revisions r
join public.articles a on a.id = r.article_id
left join public.profiles p on p.id = r.submitter_user_id
where r.submitter_user_id is not null
  and r.submitter_user_id is distinct from a.author_user_id
group by r.article_id, r.submitter_user_id, p.display_name, r.submitter_display;

comment on view public.article_contributors is
'Distinct edit-contributors per article, excluding the article''s primary author.';
