-- 0006 — let two clients share a reference.
--
-- Run this before importing real campaign data. Without it, the CSV importer
-- fails on the second client who attended the same event.
--
--
-- ## What is wrong today
--
-- `pass_ledger_external_ref_key` is `UNIQUE (external_ref)` — unique across the
-- **whole table**, not per client. So this is currently impossible:
--
--   client_ref            activity_code   earned_on     reference
--   jane@example.com      attend_event    2026-07-22    Q3 portfolio briefing
--   ahmad@example.com     attend_event    2026-07-22    Q3 portfolio briefing
--
-- Two people at one briefing. The second row violates the constraint, and
-- because the violation is on a different index than the importer's conflict
-- target, `on conflict do nothing` does not absorb it — the whole batch fails.
--
-- Blank references are worse. `external_ref` defaults to `''`, and `''` is a
-- value like any other, so **one row in the entire ledger** may have an empty
-- reference. Every finConnect download after the first is refused.
--
--
-- ## Why it is there, and why that reason has expired
--
-- It made sense when `external_ref` *was* the dedupe key. Nothing else
-- identified a row, so the loader synthesised a globally unique string and put
-- it in this column:
--
--   August:test.client05@example.com:purchase_product
--
-- That is the snapshot's signature — the month baked into a reference — and it
-- is the direct cause of the ledger double-counting. The constraint did not just
-- coexist with that bug; it required the shape that produced it.
--
-- 0005 replaced it with the right key: `(campaign_id, client_id,
-- challenge_code, occurred_on, external_ref)`. That says the true thing — one
-- client cannot earn the same activity twice on the same day under the same
-- reference — while leaving the reference free to be what it should be: a
-- human-readable name for an event that many clients can attend, or a policy
-- number that happens to be unique on its own.
--
--
-- ## Before running
--
-- Confirm the natural key exists, since it is what takes over:
--
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'pass_ledger';
--
-- `pass_ledger_natural_key` must be in that list. If it is not, run 0005 first —
-- dropping this constraint without it would leave the ledger with no protection
-- against a re-imported file at all.

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename  = 'pass_ledger'
       and indexname  = 'pass_ledger_natural_key'
  ) then
    raise exception
      'Run 0005 first: pass_ledger_natural_key does not exist, and dropping the '
      'global unique constraint without it would leave no dedupe at all.';
  end if;
end $$;

alter table public.pass_ledger
  drop constraint if exists pass_ledger_external_ref_key;


-- ---------------------------------------------------------------------------
-- Confirm
-- ---------------------------------------------------------------------------
-- `pass_ledger_external_ref_key` should be gone, and `pass_ledger_natural_key`
-- should still be listed as an index:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.pass_ledger'::regclass order by conname;
--
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'pass_ledger';
--
-- The other constraints stay and are all doing useful work:
--   pass_ledger_challenge_code_fkey  a typo'd activity code is refused outright
--                                    rather than silently earning nothing
--   pass_ledger_status_check         pending / confirmed / rejected only
--   pass_ledger_units_check          units > 0
--   pass_ledger_rate_applied_check   rate_applied > 0
