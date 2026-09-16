-- Take table access away from the anonymous role.
--
-- Background: sign-in was once failing with "permission denied for table
-- advisors". That was a missing Postgres GRANT, not a row level security
-- problem -- RLS filters rows, but a role still needs the table privilege to
-- ask in the first place. The quickest unblock was:
--
--     grant select on all tables in schema public to anon, authenticated;
--
-- `anon` was collateral. The portal never queries before sign-in: the login
-- page reads nothing, and `supabase()` is only ever called from code paths
-- behind a session. So the anonymous key -- which is compiled into the
-- JavaScript every visitor downloads -- should reach no table at all.
--
-- Two independent gates have to hold for a read to succeed: the GRANT, and the
-- RLS policy. Leaving the GRANT in place means RLS is the only thing standing
-- between a public key and the client book. This restores the second gate.
--
-- Safe to run more than once.

begin;

-- Anonymous callers keep schema usage (PostgREST needs it to answer at all,
-- including with a 401) but lose every table privilege.
revoke select on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Stop future tables from being granted to anon by default.
alter default privileges in schema public revoke select on tables from anon;

-- Signed-in users keep read access; row level security decides which rows.
-- This is deliberately SELECT only. Every write the portal will need -- the
-- CSV import, recording a draw -- belongs in a Pages Function using the
-- service role, never in the browser.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public grant select on tables to authenticated;

commit;

-- Check afterwards. Expect no rows for anon in the public schema:
--
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee in ('anon', 'authenticated')
--    order by grantee, table_name;
--
-- Then confirm a consultant can still sign in and see their clients. If a
-- sign-in now fails, the cause is an RLS policy that references `anon` rather
-- than `authenticated` -- fix the policy, do not re-grant.
