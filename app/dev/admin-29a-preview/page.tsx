/**
 * Dev-only preview of handoff 29a — the Admin Command Center overview.
 *
 * ⚠ WHY THIS EXISTS RATHER THAN JUST OPENING /admin. Two reasons, and the
 * second is the important one:
 *   1. /admin is auth-gated, so a visual pass needs an admin session.
 *   2. This checkout's `.env.local` points `DATABASE_URL` at the PRODUCTION
 *      Neon endpoint (`ep-curly-block-…`), which CLAUDE.md names explicitly.
 *      Rendering /admin locally would run every admin metric query against
 *      production to look at some borders.
 *
 * So the chrome is reviewed here against obviously-synthetic data, and the real
 * screen keeps computing everything from Postgres. Same guard and same purpose
 * as /dev/handoff-preview: 404s outside development, nothing links to it.
 *
 * ⚠ EVERY NUMBER BELOW IS INVENTED AND THIS FILE IS UNREACHABLE IN PRODUCTION.
 * If you are copying a shape out of here into product code, you are about to
 * ship a fabricated metric.
 */

import { notFound } from 'next/navigation'
import '../../admin/command-center.css'
import { AdminCommandCenterOverview } from '@/components/admin/AdminCommandCenterOverview'
import { GrowthSeriesPanel } from '@/components/admin/GrowthSeriesPanel'
import type { AdminCommandCenterMetrics } from '@/lib/admin-dashboard/AdminCommandCenterService'
import {
  bucketize,
  bucketizeDistinct,
  buildBucketKeys,
  distinctWithin,
  markCurrentBucket,
  REPORTING_TZ,
  type AdminGrowthSeries,
  type GrowthGranularity,
} from '@/lib/admin-dashboard/AdminGrowthSeriesService'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Handoff preview — 29a Command Center',
  robots: { index: false, follow: false },
}

/*
 * `buildAdminVerdict` reads only `providerHealth` and `productionReadiness`;
 * `buildPeerGroups` reads the seven metric arrays. The other ~18 fields of
 * AdminCommandCenterMetrics are untouched by this component, so the fixture
 * fills what is read and casts once, here, with this note attached — rather
 * than fabricating twenty more shapes that nothing renders.
 */
const PREVIEW_METRICS = {
  generatedAt: new Date('2026-09-01T14:32:00Z').toISOString(),

  users: [
    { label: 'Registered users', value: '1,204', tracked: true },
    { label: 'Created a bracket pool', value: '87', tracked: true },
    { label: 'Bracket entries', value: '2,918', tracked: true },
    {
      label: 'Finalized entries',
      value: '2,140',
      tracked: true,
      note: '778 started and never finalized — the email center has a segment for exactly this.',
    },
  ],
  traffic: [{ label: 'Bracket page views · 7d', value: '4,417', tracked: true }],

  subscriptions: [
    { label: 'Completed payments', value: '0', tracked: true },
    {
      label: 'Total revenue',
      value: '—',
      tracked: false,
      note: 'No completed bracket payments recorded',
    },
    { label: 'Payments last 7 days', value: '0', tracked: true },
  ],
  tokens: [
    { label: 'Token spend', value: '—', tracked: false, note: 'Ledger not instrumented for admin rollup' },
  ],

  morning: [{ label: 'Entries last 7 hours', value: '34', tracked: true }],
  health: [
    { label: 'Entries today', value: '112', tracked: true },
    { label: 'Pools created today', value: '6', tracked: true },
  ],
  integrity: [{ label: 'Flagged entries', value: '0', tracked: true }],

  providerHealth: [
    {
      id: 'sleeper',
      name: 'Sleeper',
      category: 'league import',
      status: 'active',
      configured: true,
      envVars: [],
      dataCategories: ['leagues', 'rosters'],
      consumedBy: ['League import', 'live scores', 'rosters'],
      storage: ['League'],
      requestCount24h: 412,
      avgLatencyMs24h: 180,
      rateLimit: '1000/min',
      importedRows: 8214,
      lastSyncAt: new Date('2026-09-01T14:31:20Z').toISOString(),
      note: 'Reporting normally.',
    },
    {
      id: 'yahoo',
      name: 'Yahoo',
      category: 'league import',
      status: 'not_production_ready',
      configured: true,
      envVars: ['YAHOO_CLIENT_ID'],
      dataCategories: ['leagues', 'rosters'],
      consumedBy: ['League import', 'rosters'],
      storage: ['League'],
      requestCount24h: 12,
      avgLatencyMs24h: 2400,
      rateLimit: '—',
      importedRows: 41,
      lastSyncAt: new Date('2026-09-01T12:20:00Z').toISOString(),
      note: 'Slow responses for the last two hours.',
    },
  ],

  productionReadiness: {
    env: [
      {
        id: 'stripe',
        category: 'payments',
        label: 'Stripe keys',
        status: 'present',
        severity: 'critical',
        required: 'STRIPE_SECRET_KEY',
        note: 'Configured in this runtime.',
      },
    ],
    crons: [
      {
        id: 'teams',
        category: 'sync',
        label: 'sync?job=teams',
        status: 'configured',
        schedule: 'daily',
        configuredPaths: ['/api/cron/sync?job=teams'],
        missing: [],
        recommended: 'daily',
        note: 'Wired in vercel.json.',
      },
      {
        id: 'fixtures',
        category: 'sync',
        label: 'sync?job=fixtures',
        status: 'configured',
        schedule: 'daily',
        configuredPaths: ['/api/cron/sync?job=fixtures'],
        missing: [],
        recommended: 'daily',
        note: 'Wired in vercel.json.',
      },
      {
        id: 'standings',
        category: 'sync',
        label: 'sync?job=standings',
        status: 'configured',
        schedule: '*/30',
        configuredPaths: ['/api/cron/sync?job=standings'],
        missing: [],
        recommended: 'every 30m during the tournament',
        note: 'Wired in vercel.json.',
      },
      {
        id: 'live',
        category: 'sync',
        label: 'sync?job=live',
        status: 'configured',
        schedule: '*/5',
        configuredPaths: ['/api/cron/sync?job=live'],
        missing: [],
        recommended: 'every 5m in active windows',
        note: 'Wired in vercel.json.',
      },
      {
        id: 'recalculate',
        category: 'sync',
        label: 'sync?job=recalculate',
        status: 'missing',
        schedule: '—',
        configuredPaths: [],
        missing: ['/api/cron/sync?job=recalculate'],
        recommended: 'optional',
        note: 'Optional and unset.',
      },
    ],
    trafficLocations: [],
    trafficNotes: [],
  },
} as unknown as AdminCommandCenterMetrics

/*
 * Synthetic growth series. Built through the REAL bucketing functions rather
 * than hand-written bucket arrays — if `buildBucketKeys` or `bucketize` breaks,
 * this preview breaks with it, which is the only kind of preview worth having.
 * Only the timestamps are invented.
 */
function previewGrowth(): AdminGrowthSeries {
  const now = new Date('2026-09-01T16:00:00Z')
  // A deterministic pseudo-random walk — a fixed seed so the preview does not
  // reshuffle on every render and make a real layout change hard to spot.
  let seed = 42
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const scatter = (count: number, spanDays: number, now: Date) =>
    Array.from({ length: count }, () => new Date(now.getTime() - rand() * spanDays * 86_400_000))

  const pools = { signups: scatter(340, 365, now), entries: scatter(900, 365, now),
                  poolsCreated: scatter(120, 365, now), conversions: scatter(75, 365, now) }
  const activity = Array.from({ length: 1800 }, (_, i) => ({
    createdAt: new Date(now.getTime() - rand() * 365 * 86_400_000),
    userId: `u${i % 220}`,
  }))

  const build = (granularity: GrowthGranularity) => {
    const keys = buildBucketKeys(granularity, now)
    const mk = (
      key: string, label: string, hint: string,
      buckets: ReturnType<typeof bucketize>, total?: number,
    ) => ({
      key: key as never, label, hint, tracked: true,
      // Distinct metrics pass an explicit total — summing them inflates it.
      total: total ?? buckets.reduce((s, b) => s + b.value, 0),
      // Same marking the real service applies, so the preview shows the
      // in-progress column exactly as production does.
      buckets: markCurrentBucket(buckets, granularity, now),
    })
    const activeBuckets = bucketizeDistinct(activity, granularity, keys)
    const activeTotal = distinctWithin(activity, granularity, keys)

    return {
      granularity,
      windowLabel: granularity === 'day' ? 'Last 30 days' : granularity === 'week' ? 'Last 12 weeks' : 'Last 12 months',
      metrics: [
        mk('signups', 'New signups', 'Accounts created', bucketize(pools.signups, granularity, keys)),
        mk('entries', 'Bracket entries', 'Entries submitted', bucketize(pools.entries, granularity, keys)),
        mk('pools', 'Pools created', 'New bracket pools', bucketize(pools.poolsCreated, granularity, keys)),
        mk('activeUsers', 'Active users', 'Distinct signed-in users with recorded activity', activeBuckets, activeTotal),
        mk('paidConversions', 'Paid conversions', 'New subscriptions plus completed bracket payments',
           bucketize(pools.conversions, granularity, keys)),
      ],
    }
  }

  return {
    generatedAt: now.toISOString(),
    timezone: REPORTING_TZ,
    byGranularity: { day: build('day'), week: build('week'), month: build('month') },
  } as AdminGrowthSeries
}

export default function Admin29aPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    /*
     * `af-cc--adaptive` here but NOT on /admin: this preview renders only 29a
     * chrome, which is fully tokenized, so it can honestly follow the app theme
     * and is the place to review all three modes. The real page still carries
     * ~780 hardcoded-dark utilities in the panels below 29a — see the modifier's
     * note in command-center.css.
     */
    <main className="af-cc af-cc--adaptive" style={{ minHeight: '100dvh', padding: '32px 20px 80px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <p
          style={{
            margin: '0 0 6px',
            font: "700 10px/1 var(--af-cc-mono)",
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--warn)',
          }}
        >
          Dev preview · synthetic data
        </p>
        <h1 style={{ margin: '0 0 20px', font: "900 24px/1.1 var(--af-cc-sans)", letterSpacing: '-0.03em' }}>
          29a — Admin Command Center
        </h1>

        <div className="af-cc-frame">
          <div className="af-cc-bar">
            <svg
              viewBox="0 0 100 106"
              width="22"
              height="23"
              role="img"
              aria-label="AllFantasy"
              style={{ display: 'block', overflow: 'visible', flex: 'none' }}
            >
              <path
                d="M50 4 L94 16 V60 L50 102 L6 60 V16 Z"
                style={{
                  fill: 'var(--accent-soft)',
                  stroke: 'var(--accent)',
                  strokeWidth: 7,
                  strokeLinejoin: 'round',
                }}
              />
              <text
                x="50"
                y="66"
                textAnchor="middle"
                style={{ font: "900 44px var(--af-cc-sans)", fill: 'var(--text)' }}
              >
                AF
              </text>
            </svg>
            <div className="af-cc-bar-title">Command Center</div>
            <div className="af-cc-admin-chip">Admin</div>
            <div className="af-cc-spacer" />
            <nav className="af-cc-tabs" aria-label="Command Center sections">
              <span className="af-cc-tab af-cc-tab--on">Overview</span>
              <span className="af-cc-tab">Providers</span>
              <span className="af-cc-tab">Readiness</span>
              <span className="af-cc-tab">Users</span>
              <span className="af-cc-tab">Email</span>
            </nav>
            <div className="af-cc-stamp">refreshed 10:32:00 AM</div>
          </div>

          <div className="af-cc-body">
            <AdminCommandCenterOverview metrics={PREVIEW_METRICS} />

            <GrowthSeriesPanel series={previewGrowth()} />

            {/*
              Chrome specimen. The providers table, cron list, segment rows and
              user lookup live inline in app/admin/page.tsx (and in
              EmailSegmentsPanel), which cannot render here without an admin
              session and a database. Rendering the same CLASSES against
              fixture rows is what makes the styling reviewable rather than
              merely compiled — it verifies the half of the change this file
              actually owns, which is command-center.css.
            */}
            <div className="af-cc-grid-split">
              <div className="af-cc-card">
                <div className="af-cc-card-head">
                  <div className="af-cc-card-title">Providers</div>
                  <div className="af-cc-card-scope">What breaks if it stops</div>
                </div>
                <div className="af-cc-tablescroll">
                  <div className="af-cc-trow af-cc-trow--head af-cc-providers">
                    <div className="af-cc-colhead">Provider</div>
                    <div className="af-cc-colhead">Consumed by</div>
                    <div className="af-cc-colhead af-cc-hide-sm">Last OK</div>
                    <div className="af-cc-colhead af-cc-right">Status</div>
                  </div>
                  {[
                    ['Sleeper', 'League import · live scores · rosters', '40s ago', 'ok'],
                    ['ESPN', 'Playoff seeding · SportsGame scores', '3m ago', 'ok'],
                    ['Stripe', 'Subscriptions · token ledger · bracket payments', '11m ago', 'ok'],
                    ['Yahoo', 'League import · rosters', '2h ago', 'slow'],
                  ].map(([name, used, seen, state]) => (
                    <div key={name} className="af-cc-trow af-cc-providers">
                      <div className="af-cc-cell-name">{name}</div>
                      <div className="af-cc-cell-sub">{used}</div>
                      <div
                        className={
                          state === 'slow' ? 'af-cc-cell-time af-cc-cell-time--warn af-cc-hide-sm' : 'af-cc-cell-time af-cc-hide-sm'
                        }
                      >
                        {seen}
                      </div>
                      <div className="af-cc-right">
                        <span className={state === 'slow' ? 'af-cc-chip af-cc-chip--warn' : 'af-cc-chip af-cc-chip--ok'}>
                          {state === 'slow' ? 'Slow' : 'OK'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="af-cc-card">
                <div className="af-cc-card-head">
                  <div className="af-cc-card-title">Cron readiness</div>
                  <div className="af-cc-card-scope">4 of 5 set</div>
                </div>
                <div className="af-cc-joblist">
                  {PREVIEW_METRICS.productionReadiness.crons.map((row) => (
                    <div
                      key={row.id}
                      className={row.status === 'configured' ? 'af-cc-job' : 'af-cc-job af-cc-job--warn'}
                    >
                      <span className="af-cc-job-tick" aria-hidden="true">
                        {row.status === 'configured' ? '✓' : '·'}
                      </span>
                      <div className="af-cc-stack" style={{ flex: 1 }}>
                        <div className="af-cc-job-name">{row.label}</div>
                        <div className="af-cc-job-cadence">{row.recommended}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="af-cc-grid2">
              <div className="af-cc-card">
                <div className="af-cc-card-head">
                  <div className="af-cc-card-title">Email segments</div>
                  <div className="af-cc-card-action">Compose</div>
                </div>
                <div className="af-cc-card-body">
                  {[
                    ['Unfinalized brackets', 'Started an entry, never submitted', '778', 'warn'],
                    ['Pool commissioners', 'Owns at least one pool', '87', ''],
                    ['Paying customers', 'Any completed payment', '0', ''],
                    ['Played last season, not this one', 'Win-back list for the MLB reopen', '1,441', 'accent'],
                  ].map(([label, desc, count, tone]) => (
                    <div key={label} className="af-cc-seg">
                      <span className="af-cc-stack" style={{ flex: 1 }}>
                        <span className="af-cc-job-name">{label}</span>
                        <span className="af-cc-job-cadence">{desc}</span>
                      </span>
                      <span className={tone ? `af-cc-seg-count af-cc-seg-count--${tone}` : 'af-cc-seg-count'}>
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="af-cc-card">
                <div className="af-cc-card-head">
                  <div className="af-cc-card-title">Find a user</div>
                  <label className="af-cc-search">
                    <span className="af-cc-search-ring" aria-hidden="true" />
                    <input className="af-cc-search-input" placeholder="email or username" aria-label="Search users" />
                  </label>
                </div>
                <div className="af-cc-trow af-cc-trow--head af-cc-users">
                  <div className="af-cc-colhead">User</div>
                  <div className="af-cc-colhead af-cc-right">Entries</div>
                  <div className="af-cc-colhead af-cc-right">Pools</div>
                  <div className="af-cc-colhead af-cc-right">Plan</div>
                </div>
                {[
                  ['ReviewerOne', 'reviewer-one@example.test', '14', '6', 'Supreme'],
                  ['ReviewerTwo', 'reviewer-two@example.test', '3', '1', 'Free'],
                  ['ReviewerThree', 'reviewer-three@example.test', '9', '0', 'Pro'],
                ].map(([user, email, entries, pools, plan]) => (
                  <div key={user} className="af-cc-trow af-cc-users">
                    <div className="af-cc-stack">
                      <span className="af-cc-cell-name">{user}</span>
                      <span className="af-cc-cell-faint">{email}</span>
                    </div>
                    <div className="af-cc-cell-num af-cc-right">{entries}</div>
                    <div className="af-cc-cell-num af-cc-right">{pools}</div>
                    <div className="af-cc-right">
                      <span className={plan === 'Supreme' ? 'af-cc-chip af-cc-chip--accent' : 'af-cc-chip'}>{plan}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
