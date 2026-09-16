-- Is `pass_ledger` an event log?
--
-- Read-only. Run the whole file in the Supabase SQL editor after a load and
-- read the answers; nothing here changes anything.
--
-- The question matters because the ledger started life as a per-draw snapshot:
-- every row for a client carried the same `occurred_on` with the month baked
-- into `external_ref`, so July's file re-stated June's passes instead of adding
-- to them. The portal sums the ledger, so it reported 84 gold for a client who
-- had earned 42, and the number grew every month.
--
-- An event log is the opposite: one row per thing that actually happened, on
-- the date it happened, with a reference that names the thing rather than the
-- month it was loaded in. Each query below asks one way that could still be
-- wrong. **Every one of them should return no rows.**


-- ---------------------------------------------------------------------------
-- 1. No month-stamped references
-- ---------------------------------------------------------------------------
-- The snapshot's signature. The one this ledger actually carried was
--
--   August:test.client05@example.com:purchase_product
--
-- — a bare month name, no year. So a month name **on its own** has to count:
-- requiring a year alongside it, as an earlier version of this check did, let
-- the real format through, which is the only format it was written for.
--
-- A reference naming a period rather than a policy, a referral or an event
-- means the row is restating a balance, not recording an event.
--
-- This one can flag a legitimate reference — "May market update" is a real
-- event name. That is the intended trade: read what comes back rather than
-- assuming it is wrong. A month name in a reference is at best ambiguous with
-- the thing that broke this ledger once already.
select id, client_id, challenge_code, occurred_on, external_ref
  from public.pass_ledger
 where external_ref ~* '(19|20)[0-9]{2}[-_/ ]?(0[1-9]|1[0-2])'
    or external_ref ~* ('\m(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'
                      || '|january|february|march|april|june|july|august'
                      || '|september|october|november|december)\M')
 order by occurred_on, client_id;


-- ---------------------------------------------------------------------------
-- 2. No duplicate natural keys
-- ---------------------------------------------------------------------------
-- 0005's unique index makes this impossible going forward. Run it anyway: if it
-- returns anything, the index is not there.
select campaign_id, client_id, challenge_code, occurred_on, external_ref, count(*)
  from public.pass_ledger
 group by 1, 2, 3, 4, 5
having count(*) > 1;


-- ---------------------------------------------------------------------------
-- 3. Nothing clustered on the load date
-- ---------------------------------------------------------------------------
-- Real activity is spread across the month it happened in. A day holding a
-- large share of the whole ledger is the load date wearing `occurred_on`'s
-- clothes — which is what makes every pass land in the ballot for the month the
-- file was uploaded rather than the month it was earned.
--
-- Volume alone is not the test, though: a client event genuinely does put forty
-- people on one date, and flagging that would train you to ignore this check.
-- What separates the two is **breadth**. A real busy day is one or two activity
-- codes — the event, and the guests brought to it. A load date is every code at
-- once, because that is what a snapshot of everyone's balances looks like.
select occurred_on,
       count(*) as rows_on_this_day,
       round(100.0 * count(*) / nullif((select count(*) from public.pass_ledger), 0), 1) as pct_of_ledger,
       count(distinct challenge_code) as distinct_activities,
       string_agg(distinct challenge_code, ', ' order by challenge_code) as which
  from public.pass_ledger
 group by occurred_on
having count(*) > 0.25 * (select count(*) from public.pass_ledger)
   and count(distinct challenge_code) >= 4
 order by occurred_on;


-- ---------------------------------------------------------------------------
-- 4. Every challenge_code is on the rate card
-- ---------------------------------------------------------------------------
-- A code with no live `challenge_types` row earns nothing: the portal cannot
-- price it, so the passes silently do not appear. There is no foreign key on
-- this column, so a typo in a spreadsheet survives all the way in.
select l.challenge_code, count(*) as rows_affected, sum(l.passes_awarded) as passes_lost
  from public.pass_ledger l
  left join public.challenge_types c
    on c.code = l.challenge_code and c.is_active
 where c.code is null
 group by l.challenge_code
 order by rows_affected desc;


-- ---------------------------------------------------------------------------
-- 5. The arithmetic on each row agrees with itself
-- ---------------------------------------------------------------------------
-- `passes_awarded` should be `units * rate_applied`, and `rate_applied` should
-- be the rate the card actually carries. A row that disagrees was either
-- hand-edited or loaded against a different rate card.
select l.id, l.client_id, l.challenge_code, l.units, l.rate_applied,
       l.passes_awarded, c.passes_per_unit as card_rate
  from public.pass_ledger l
  join public.challenge_types c on c.code = l.challenge_code
 where l.passes_awarded is distinct from l.units * l.rate_applied
    or l.rate_applied is distinct from c.passes_per_unit;


-- ---------------------------------------------------------------------------
-- 6. Once-per-client activities earned once
-- ---------------------------------------------------------------------------
-- finConnect and the testimonial count once per client, ever. Keep this list in
-- step with ONCE_PER_CLIENT in `src/lib/campaignRules.ts` — the portal's cap is
-- stated there, and a code in one list but not the other is the cap quietly not
-- applying.
select client_id, challenge_code, count(*) as times_earned, sum(passes_awarded) as passes
  from public.pass_ledger
 where challenge_code in ('finconnect', 'testimonial')
   and coalesce(status, 'valid') not ilike '%void%'
 group by client_id, challenge_code
having count(*) > 1
 order by times_earned desc;


-- ---------------------------------------------------------------------------
-- 7. Nothing earned outside the campaign window
-- ---------------------------------------------------------------------------
-- A date typed as 2025 instead of 2026 is invisible on screen: the row simply
-- never appears in any ballot.
select l.id, l.client_id, l.challenge_code, l.occurred_on,
       c.start_date, c.end_date
  from public.pass_ledger l
  join public.campaigns c on c.id = l.campaign_id
 where l.occurred_on < c.start_date or l.occurred_on > c.end_date
 order by l.occurred_on;


-- ---------------------------------------------------------------------------
-- 8. Every row belongs to a client that exists
-- ---------------------------------------------------------------------------
select l.client_id, count(*) as orphan_rows
  from public.pass_ledger l
  left join public.clients cl on cl.id = l.client_id
 where cl.id is null
 group by l.client_id;


-- ---------------------------------------------------------------------------
-- And one that should return rows: the totals a consultant will read out
-- ---------------------------------------------------------------------------
-- Not a check so much as the sanity test. Compare a few of these against what
-- the client actually did. Gold here is the campaign-close pool, so it only
-- ever grows; blue is split by the month it was earned, because a blue pass
-- enters that month's ballot and is used up by it.
select cl.client_name,
       to_char(l.occurred_on, 'YYYY-MM') as earned_month,
       ct.pass_type,
       sum(l.passes_awarded) as passes
  from public.pass_ledger l
  join public.clients cl on cl.id = l.client_id
  join public.challenge_types ct on ct.code = l.challenge_code
 where coalesce(l.status, 'valid') not ilike '%void%'
 group by cl.client_name, earned_month, ct.pass_type
 order by cl.client_name, earned_month, ct.pass_type;
