# LuckyFinexis

Lucky draw pass management for a financial advisory firm's client campaign: a consultant sees every client on
their book, how many valid boarding passes each holds, and exactly how each one was earned.

This repository currently holds the **front end** — a Vite + React + TypeScript app built for
Cloudflare Pages, talking to Supabase. It runs today against a built-in demo dataset, so the
whole portal can be clicked through before a Supabase project exists.

```bash
npm install
npm run dev          # http://localhost:5173, demo data, no backend needed
npm test             # 43 tests over the pass arithmetic, CSV parser and ingest rules
npm run build        # tsc -b && vite build -> dist/
```

## The two views

| Role | Route | What it shows |
|---|---|---|
| **Consultant** | `/clients` | Every client of theirs holding passes — name, mobile, email, gold and blue totals — with the full breakdown behind the magnifier icon, campaign details, and past monthly winners. |
| **Admin** | `/admin` | CSV upload for pass activity, with a dry run before anything is written. |

One sign-in form serves both. Which portal you land on is decided by the role on your
record, not by the form you used.

**Clients are records, not users.** They do not sign in and have no page of their own: the
database carries no auth link on `clients`, and a client's standing reaches them through
their consultant. The full statement — totals, the activity breakdown, prizes won — is
rendered behind the magnifier icon on the consultant's table.

A consultant with no qualifying clients still gets their page, with an empty table — being at
zero early in a campaign is a normal state, not an error.

## How passes work

Two pass types, gold and blue, each earned through campaign activities that are **data, not
code**. Adding "Refer a colleague — 4 passes per referral" is a row in `activities`; the
statement, the totals and the CSV importer all pick it up with no code change.

The demo campaign ships the activities from the campaign brief:

| Activity | Pass type | Rate |
|---|---|---|
| Purchase Qualifying Product | Gold | 21 per case |
| Successful Referral Purchase | Gold | 21 per referral |
| Submit Referrals | Blue | 2 per referral |
| Attend Client Events | Blue | 5 per event |
| Bring Guests For Client Events | Blue | 10 per guest |
| Submit A Testimonial | Blue | 3 |
| Download finConnect | Blue | 1 |

**A pass has a status.** `valid` counts toward a draw. `pending` is earned but not yet
countable — a policy still inside its free-look window, a referral that has not completed.
`void` is a pass that was clawed back, kept rather than deleted so the ledger stays auditable.
Only valid passes appear in a total; pending and voided ones are summarised beneath the table
so a client can see why a number is lower than they expected.

**A pass has a draw month.** A pass earned in July is in the July draw and every draw after it,
so eligibility is "earned on or before this month", not "earned in this month". `draw_month`
defaults to the month of `earned_on` and can be set later to defer a pass, never earlier.

**Winning may or may not spend passes.** `consumedByDrawId` on the ledger supports it and
`campaigns.consume_passes_on_win` switches it on. The demo has it **off**, because the campaign
mockup shows a client keeping all 50 blue passes after winning in August. Confirm against the
campaign terms before going live — this is the one rule in here taken from a picture rather
than from a document.

## The ledger, and why uploads are safe to repeat

Pass activity is an **append-only ledger**. An upload never overwrites anything: each row either
becomes a new pass event, is recognised as one already stored, or is rejected with a reason.

A row is "already stored" when its client, activity, date and reference all match an existing
entry. That is the natural key, and it is why re-uploading last month's export adds nothing
rather than doubling everybody's passes. `reference` — a policy number, a referral name, an
event name — is what separates two genuinely different events on the same day.

Uploading is two steps on purpose. The file is validated and reported on first, and nothing is
written until the counts are confirmed, so a mis-mapped column shows up as a page of rejected
rows instead of a month of wrong pass counts.

### CSV columns

Required: `client_ref`, `activity_code`, `units`, `earned_on`.
Optional: `fc_code`, `client_name`, `client_email`, `client_mobile`, `reference`, `draw_month`,
`status`, `void_reason`.

Header names are matched loosely, so `Client Ref` and `client_ref` both land. The admin page
documents every column and offers a blank template.

## Architecture

```
Browser ──► Cloudflare Pages (static React app)
   │
   ├──► Supabase PostgREST      reads, constrained by row level security
   ├──► Supabase Auth           email + password for all three roles
   └──► Pages Functions ──► Supabase service role   CSV ingest and other privileged writes
```

Reads go straight from the browser to Supabase. **Row level security is the access control** —
a client asking for every pass event simply receives their own rows, and a consultant receives
their own clients'. The `.eq()` filters in `src/data/supabaseApi.ts` keep responses small; they
are not what keeps them safe. `RequireRole` in the router is the same: a convenience that
avoids showing someone a page of failed queries, not a security boundary.

Privileged writes never happen from the browser. The service role key belongs only in a Worker
secret. Anything named `VITE_*` is compiled into the JavaScript the browser downloads.

### Layout

```
src/
  lib/         types, pass arithmetic, CSV parser, ingest rules, formatting   (no React)
  data/        api.ts (the interface) + mockApi / supabaseApi + the selector
  auth/        AuthProvider, RequireRole
  components/  AppShell, ClientStatementPanel, Modal, CampaignDetailsModal, icons
  pages/       LoginPage, ClientPage, AdvisorPage, AdminPage
  styles/      tokens.css, app.css
```

Pages import the `PortalApi` interface, never a provider, so swapping the backend touches only
`src/data/`. The pass rules live in `src/lib/` with no React import, which is what makes them
testable and what will let the Worker reuse them.

The client statement is one component, used both by the client's own page and by the
consultant's details pop-up — there is exactly one description of how a client's passes add up.

## How the app maps onto the database

The schema this connects to uses its own names, and `src/data/supabaseApi.ts` is the whole
of the translation — nothing outside `src/data/` knows the database exists.

| App concept | Table | Notes |
|---|---|---|
| Pass event | `pass_ledger` | `passes_awarded`, falling back to `units × rate_applied` |
| Activity | `challenge_types` | Keyed by `code`; a global rate card, not per-campaign |
| Draw | `draws` | One row per month **per pass type**; the portal collapses them to one chip per month |
| Winner | `prizes_won` | No display name column, so names are shortened from `clients` |
| Consultant | `advisors` | Linked to auth by `auth_user_id` |

Some judgement calls worth knowing about:

- **The draw month comes from `draw_date`, not `monthly_draw`.** `monthly_draw` is free
  text and may hold "August", "Aug 2026" or "2026-08" depending on who typed it, so it is
  treated as a label rather than parsed.
- **`pass_ledger.draw_id` is read as the draw a pass is entered into**, setting the first
  month it counts for. Without one, the month comes from `occurred_on`.
- **`pass_ledger.status` is folded from free text** — anything containing "void", "cancel",
  "reversed" and similar is void; "pending", "provisional", "free-look" and similar are
  pending; everything else counts. Narrow `VOID_WORDS` / `PENDING_WORDS` if the column
  carries states those miss.
- **Nothing is treated as spent.** There is no consumed column, matching the campaign term
  that winning does not spend passes.
- **Roles.** There is no profiles table: the `advisors` row is the source of truth, and an
  admin is marked by `app_metadata.role`, which only the service role can set. A sign-in
  matching neither is refused rather than defaulted.
- **Clients cannot sign in.** `clients` has no auth column; they are records, not users.
- **Winner names follow RLS.** They are read from `clients`, so an advisor sees their own
  clients named and everyone else's as "A client" — the firm-wide list is only as legible
  as the policies allow.

## Running against Supabase

```bash
cp .env.example .env
# VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_USE_MOCK=false
```

If either key is missing the app falls back to demo data rather than failing — the yellow
"Demo data" banner is how you tell.

The app expects these tables — `profiles`, `advisors`, `clients`, `campaigns`, `activities`,
`pass_events`, `draws`, `draw_winners` — and a private `campaign-assets` storage bucket. Column
names are the snake_case of the types in `src/lib/types.ts`; `src/data/supabaseApi.ts` has the
exact shape of every row it reads.

## Deploying to Cloudflare Pages

Connect the repo in the Cloudflare dashboard under Workers & Pages → Create → **Pages**
→ Connect to Git, and set:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (leave empty) |

Or from your machine:

```bash
npx wrangler login
npm run pages:deploy
```

Environment variables are build-time, so changing one needs a fresh build to take effect.
For a demo deployment with no backend, `VITE_USE_MOCK=true` is the only one required. For a
real deployment set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and keep the service
role key out of the browser entirely:

```bash
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
```

`public/_redirects` serves the shell for every path, so a deep link like `/clients` returns
the app rather than a 404. `public/_headers` sets the security headers and caches hashed
assets. `.nvmrc` pins the build to Node 22.

This targets Pages, not Workers. The two use different deploy paths: a Pages project needs
`pages_build_output_dir` in `wrangler.jsonc` (as here), while a Worker needs an `assets`
block instead — `wrangler deploy` refuses to run against a config carrying the Pages key,
and vice versa.

## Not built yet

This pass is the front end. Still to come, in rough order:

1. **SQL migrations** — the tables above, plus the row level security policies the whole
   security model rests on. Nothing should reach production before these exist and are tested.
2. **Pages Functions** — `POST /api/uploads/preview` and `POST /api/uploads/commit`, which
   verify the caller's JWT, re-check that they are an admin, and reuse `src/lib/ingest.ts` so
   the browser and the server agree on what a valid row is. `supabaseApi` already calls them.
3. **Admin: campaign artwork and winners** — the mockups have an admin uploading the campaign
   details image and publishing each month's winners. Both are read correctly by the
   consultant view; neither has an editor yet. Until artwork is uploaded, the details pop-up
   falls back to the campaign's earning rules rendered from the activity table.
4. **Account provisioning** — invite, first-login password set, and password reset.
5. **Sub-admin role** — a restricted admin that can import data but not manage campaigns.

Winners are listed to other consultants by first name and last initial. Revisit that with
whoever owns client privacy before launch.
