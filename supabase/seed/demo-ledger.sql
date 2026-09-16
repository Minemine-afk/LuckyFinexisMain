-- Demo pass activity, in event-log shape.
--
-- For clicking through the portal before real campaign data is loaded, and for
-- rehearsing an import against something that behaves like the real thing.
-- It writes one row per event, on the date the event happened — which is the
-- whole distinction between this and the per-draw snapshot it replaces.
--
-- **Every row is tagged `SEED-` in `external_ref`**, so it comes out again in
-- one statement and can never be confused with a real import:
--
--   delete from public.pass_ledger where external_ref like 'SEED-%';
--
-- Safe to run more than once: the unique index from 0005 makes a second run a
-- no-op rather than a doubling, which is the same property a real re-import has.
--
-- It generates activity for whichever clients are already in `clients`. It does
-- not invent people.

insert into public.pass_ledger (
  campaign_id, client_id, challenge_code, draw_id,
  units, rate_applied, passes_awarded, status,
  occurred_on, external_ref, date_updated
)
select
  campaign.id,
  roster.client_id,
  plan.challenge_code,
  -- Left null on purpose. The ballot a pass enters is derived from its date and
  -- the campaign's draw schedule; writing a draw_id here would assert a
  -- membership the rules can contradict. See `commitUpload` in supabaseApi.ts.
  null,
  plan.units,
  ct.passes_per_unit,
  plan.units * ct.passes_per_unit,
  'confirmed',
  plan.occurred_on,
  'SEED-' || plan.reference || '-' || roster.n,
  current_date
from (
  select id from public.campaigns
   where is_active order by start_date desc limit 1
) as campaign
cross join (
  -- Numbered so each client gets a different slice of the activity below,
  -- rather than every client looking identical.
  select id as client_id, row_number() over (order by client_name) as n
    from public.clients
) as roster
cross join (
  -- challenge_code, when it happened, units, which clients get it (n % every = 0),
  -- and the reference that names the specific event.
  --
  -- Dates are spread across the campaign's months deliberately: a blue pass
  -- enters the ballot for the month in `occurred_on` and is used up by it, so a
  -- column of identical dates would put every client in one draw and hide the
  -- behaviour this data exists to demonstrate.
  values
    ('purchase_product',  date '2026-07-14', 1, 3, 'POL-7714'),
    ('attend_event',      date '2026-07-22', 1, 1, 'Q3 portfolio briefing'),
    ('bring_guest',       date '2026-07-22', 2, 4, 'Q3 portfolio briefing'),
    ('submit_referral',   date '2026-08-05', 3, 2, 'Referral batch R2'),
    ('attend_event',      date '2026-08-19', 1, 2, 'Mid-year market clinic'),
    ('referral_purchase', date '2026-08-27', 1, 5, 'REF-8827'),
    ('purchase_product',  date '2026-09-03', 1, 4, 'POL-9903'),
    ('attend_event',      date '2026-09-15', 1, 3, 'Autumn client evening'),
    -- One row each, and only one: these count once per client, ever. A second
    -- row here would be caught by the importer but not by this file, which
    -- writes straight to the table.
    ('finconnect',        date '2026-07-09', 1, 1, 'app install'),
    ('testimonial',       date '2026-08-12', 1, 6, 'written testimonial')
) as plan(challenge_code, occurred_on, units, every, reference)
join public.challenge_types ct
  on ct.code = plan.challenge_code and ct.is_active
where roster.n % plan.every = 0
on conflict (campaign_id, client_id, challenge_code, occurred_on, external_ref)
  do nothing;


-- What landed, per client and month. Blue is split by month because a blue pass
-- enters that month's ballot; gold pools to the close of the campaign.
select cl.client_name,
       to_char(l.occurred_on, 'YYYY-MM') as earned_month,
       ct.pass_type,
       sum(l.passes_awarded) as passes
  from public.pass_ledger l
  join public.clients cl on cl.id = l.client_id
  join public.challenge_types ct on ct.code = l.challenge_code
 where l.external_ref like 'SEED-%'
 group by cl.client_name, earned_month, ct.pass_type
 order by cl.client_name, earned_month, ct.pass_type;
