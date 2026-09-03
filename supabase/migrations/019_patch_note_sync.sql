-- Patch notes are no longer uploaded through the contribution pipeline; they
-- are mirrored from the official site (https://www.playtyr.com/patch-notes) by
-- the sync service in src/lib/server/patch-notes-sync.ts.
--
-- Mirrored rows still live in `public.articles` as type = 'patch', so every
-- reader (listing, detail page, home dispatches, public API) keeps working
-- unchanged. What they need on top is provenance: which upstream note a row
-- came from, what we last saw there, and when we last looked. That lets the
-- sync be idempotent (skip notes whose upstream content hasn't moved) and lets
-- it refuse to clobber a hand-authored row that happens to share a slug.
--
-- Safe to re-run: every statement is guarded.

----------------------------------------------------------------------
-- 1. Provenance columns.
----------------------------------------------------------------------

-- 'local'    — authored here through the contribution pipeline (the default,
--              so every pre-existing row keeps its meaning).
-- 'official' — mirrored from the official Tyr site by the sync service.
alter table public.articles
    add column if not exists source text not null default 'local';

-- Upstream identity. `source_key` is the upstream slug (stable, and what the
-- official permalink is built from); `source_url` is the canonical upstream
-- page we link readers out to for attribution.
alter table public.articles
    add column if not exists source_key text;

alter table public.articles
    add column if not exists source_url text;

-- Hash of the normalised upstream payload we last mirrored. The sync compares
-- against this to decide between "nothing changed" and "upstream was edited",
-- so a run over 30 unchanged notes performs no writes at all.
alter table public.articles
    add column if not exists source_hash text;

-- Upstream's own updated_at, kept verbatim for display/debugging, and the
-- wall-clock time of our last successful check on this row.
alter table public.articles
    add column if not exists source_updated_at timestamptz;

alter table public.articles
    add column if not exists source_synced_at timestamptz;

----------------------------------------------------------------------
-- 2. Constrain the vocabulary.
----------------------------------------------------------------------

alter table public.articles
    drop constraint if exists articles_source_check;

alter table public.articles
    add constraint articles_source_check
    check (source in ('local', 'official'));

-- A mirrored row must carry the upstream key it was mirrored from, and a local
-- row must not pretend to have one.
alter table public.articles
    drop constraint if exists articles_source_key_check;

alter table public.articles
    add constraint articles_source_key_check
    check (
        (source = 'local' and source_key is null)
        or (source <> 'local' and source_key is not null)
    );

----------------------------------------------------------------------
-- 3. One row per upstream note.
----------------------------------------------------------------------

-- Partial so the many local rows (all NULL source_key) don't collide. This is
-- the index the sync looks a note up by, and the guard that makes a concurrent
-- double-run insert fail loudly instead of duplicating a note.
create unique index if not exists idx_articles_source_key
    on public.articles (source, source_key)
    where source <> 'local';

-- The sync's staleness sweep reads mirrored rows ordered by last check.
create index if not exists idx_articles_source_synced_at
    on public.articles (source, source_synced_at)
    where source <> 'local';

----------------------------------------------------------------------
-- 4. Keep bookkeeping writes out of `updated_at`.
----------------------------------------------------------------------

-- `articles_touch_updated_at` (migration 007) stamps `updated_at = now()` on
-- every UPDATE. The patch note sync writes `source_synced_at` (and sometimes
-- `source_updated_at`) on notes whose content has NOT changed, just to record
-- that it looked — and under the old trigger that made every mirrored note
-- look freshly edited every hour: /admin/articles orders by `updated_at`, so
-- patch notes would permanently sit at the top of the moderation queue, and
-- the public pages would report a bogus edit time.
--
-- So: when an UPDATE changes nothing but those bookkeeping columns, carry the
-- old `updated_at` through. Any real column change still stamps it.
create or replace function public.touch_articles_updated_at()
returns trigger as $$
begin
    if (to_jsonb(new) - 'updated_at' - 'source_synced_at' - 'source_updated_at')
       = (to_jsonb(old) - 'updated_at' - 'source_synced_at' - 'source_updated_at') then
        new.updated_at = old.updated_at;
    else
        new.updated_at = now();
    end if;
    return new;
end;
$$ language plpgsql;

alter function public.touch_articles_updated_at() set search_path = public, pg_temp;

drop trigger if exists articles_touch_updated_at on public.articles;

create trigger articles_touch_updated_at
    before update on public.articles
    for each row execute function public.touch_articles_updated_at();
