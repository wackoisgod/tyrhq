-- Drop the article_submissions_no_self_approval CHECK constraint.
--
-- The original intent was to block contributors from approving their own
-- submissions, but a CHECK constraint can't see profiles.role, so it also
-- blocks the legitimate admin self-approval case (and admins are explicitly
-- exempt per the design — see decideSubmission in src/lib/server/submissions.ts).
--
-- The application layer already enforces "reviewer ≠ submitter unless admin"
-- with a clearer error message. This migration removes the redundant DB rule
-- so admin self-publish actually completes the post-approve UPDATE.

alter table public.article_submissions
    drop constraint if exists article_submissions_no_self_approval;
