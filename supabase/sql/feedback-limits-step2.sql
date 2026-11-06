-- ReviewRise: STEP 2 of 2. Run this ONLY after step 1 is installed, the new review page is live,
-- and a test rating through the review page has worked.
--
-- It closes the old route: from now on feedback can only be saved through public.submit_feedback(),
-- so the duplicate and flood limits cannot be bypassed by writing to the table directly.
-- Dashboard owners can still READ their own feedback.

revoke all on table public."Feedback" from anon;
revoke insert, update, delete, truncate, references, trigger on table public."Feedback" from authenticated;
