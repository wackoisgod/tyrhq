-- Reviewer inline suggested edits.
--
-- When a reviewer requests changes they can also propose an edited version of
-- the submission body. That proposed markdown is stored here so the author can
-- review it as accept/reject diffs back in the editor. Null means the reviewer
-- left only a free-text note (the prior behaviour). Cleared once the author
-- resolves the suggestions or resubmits.

alter table public.article_submissions
    add column if not exists reviewer_body_markdown text null;
