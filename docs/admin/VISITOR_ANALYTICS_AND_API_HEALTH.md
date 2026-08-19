# Admin: Visitor Analytics (charts + globe) & API Health

This adds four things to the admin panel:

1. **Excel-style traffic charts** — total vs. unique visitors over 6h / 12h / 24h / 7d / 1mo / 6mo / 12mo (recharts).
2. **A rotating globe** of where visitors are (react-simple-maps), sized by traffic, with a top-countries leaderboard.
3. **Time-bucketed unique + non-unique IP counts** for each of those windows.
4. **API health status + potential errors** — live DB ping, endpoint self-checks, and env/cron readiness turned into a ranked error list.

No new npm dependencies are required — `recharts`, `react-simple-maps`, `@types/topojson-specification`, and `@sentry/nextjs` are already in `package.json`.

---

## Files delivered (new — these persist through the bridge)

| File | Purpose |
|---|---|
| `lib/admin-dashboard/VisitorAnalyticsService.ts` | Server service: time-bucketed unique/total + globe points. Works today from existing tables; more accurate once `SiteVisit` exists. |
| `app/api/admin/visitor-analytics/route.ts` | Admin-gated GET `?window=6h…12mo`. |
| `lib/admin-dashboard/ApiHealthService.ts` | Server service: DB ping + self-checks + readiness → errors. |
| `app/api/admin/api-health/route.ts` | Admin-gated GET. |
| `components/admin/VisitorAnalyticsPanel.tsx` | Charts + window selector + summary cards. |
| `components/admin/VisitorGlobePanel.tsx` | Orthographic globe + country leaderboard. |
| `components/admin/ApiHealthPanel.tsx` | Service table + latency chart + potential errors. |
| `lib/analytics/recordSiteVisit.ts` | Records a **hashed** IP per hit (privacy-safe). |

## Data sources & accuracy

- **Globe + all-time totals** use the existing `VisitorLocation` table (it already stores `lat`/`lng`/`visits` via `ip-api.com`). These work **immediately**.
- **Per-window unique-vs-total** is only exact with a **per-hit log**, because `VisitorLocation` stores one cumulative row per IP. Until you add `SiteVisit` (below), the service falls back to `AnalyticsEvent` (session-based) and labels the mode in the UI (`Session estimate`). Once `SiteVisit` is live it switches to `IP-accurate` automatically.

---

## Step 1 — Add the `SiteVisit` model (tracked file: `prisma/schema.prisma`)

Append this model. It stores a salted hash, never a raw IP.

```prisma
model SiteVisit {
  id        String   @id @default(cuid())
  ipHash    String
  path      String?
  country   String?
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([ipHash, createdAt])
}
```

Then create + apply the migration and regenerate the client:

```bash
npx prisma migrate dev --name add_site_visit      # local
# or, for prod deploy flow already in package.json:
npm run db:migrate:deploy
```

Add a salt to each environment (`.env`, Vercel/Railway):

```
SITE_VISIT_SALT="<any long random string>"
```

## Step 2 — Record a hit (tracked file: `app/api/track-visitor/route.ts`)

You already POST to `/api/track-visitor` on visits. Add **two lines** so each hit is also logged to `SiteVisit`. Inside the `POST` handler, right after `const ip = getClientIp(request)`:

```ts
import { recordSiteVisit } from "@/lib/analytics/recordSiteVisit"   // top of file

// ...after you resolve `ip` (fire-and-forget, never blocks the response):
void recordSiteVisit(ip, { path: request.headers.get("referer") })
```

> If you prefer to capture **every** request (not just ones that hit the tracker), call `recordSiteVisit` from `middleware.ts` instead — but keep it cheap and never `await` it in the hot path.

## Step 3 — Wire the panels into the admin page (tracked file: `app/admin/page.tsx`)

Add the imports near the other `components/admin` imports:

```ts
import { VisitorAnalyticsPanel } from "@/components/admin/VisitorAnalyticsPanel"
import { VisitorGlobePanel } from "@/components/admin/VisitorGlobePanel"
import { ApiHealthPanel } from "@/components/admin/ApiHealthPanel"
```

Then drop these sections into the returned layout. A natural spot is right after the existing `<TrafficGeoPanel … />` (they’re all traffic/health):

```tsx
<AccordionSection id="visitor-analytics" title="Visitor Analytics" eyebrow="unique vs total · 6h → 12mo">
  <VisitorAnalyticsPanel />
</AccordionSection>

<AccordionSection id="visitor-globe" title="Visitor Globe" eyebrow="where your traffic is" defaultOpen={false}>
  <VisitorGlobePanel />
</AccordionSection>

<AccordionSection id="api-health" title="API Health & Errors" eyebrow="live reachability + config gaps">
  <ApiHealthPanel />
</AccordionSection>
```

Optionally add quick links to the overview deck’s `quickLinks` array:

```ts
{ href: "#visitor-analytics", label: "Traffic" },
{ href: "#api-health", label: "API Health" },
```

## Step 4 — Verify

```bash
npm run typecheck
npm run build
```

Then load `/admin`:

- **Visitor Analytics** — switch windows (6h…12mo); bars = total, green line = unique. Before Step 1/2 it shows `Session estimate`; after, `IP-accurate`.
- **Visitor Globe** — spins automatically; bubbles sized by visits; pause/rotate controls; top-countries list. Needs `VisitorLocation` rows (they already accumulate from `/api/track-visitor`).
- **API Health & Errors** — DB/endpoint status, latency chart, and a ranked list of missing env/cron issues.

---

## Notes & options

- **CSP / globe map data:** the globe loads `world-atlas` topojson from `cdn.jsdelivr.net`. If your Content-Security-Policy blocks it, download `countries-110m.json` into `/public` and set `GEO_URL = "/countries-110m.json"` at the top of `VisitorGlobePanel.tsx`.
- **Privacy:** raw IPs are never sent to the browser or stored in `SiteVisit` (hash only), consistent with the existing “raw IPs are not selected or rendered” posture.
- **No-migration mode:** every service is wrapped in try/catch and feature-detects `SiteVisit`, so nothing crashes the admin page if you deploy the panels before running the migration — they degrade to estimate mode and label it.
- **Bridge caveat:** the three Step 1–3 edits are to *tracked* files, which this cloud session’s file bridge reverts. Apply them from the desktop app’s **Run this task → On your computer**, or paste them in manually. All eight new files were written straight into the repo.
```
