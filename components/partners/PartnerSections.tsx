import Link from 'next/link'
import type { ReactNode } from 'react'
import { VIZ } from '@/components/partners/vizTokens'
import {
  TIER_LABEL,
  activityTrendPct,
  freshnessLabel,
  tierFor,
  type DataQualityRow,
  type DemoLeague,
  type Tier,
} from '@/lib/partner-portal/demoTenant'
import { WIDGET_MODE_MIN_TIER } from '@/lib/decision-os/sdk/partner-permissions'

export function Card({ title, subtitle, children, id }: { title: string; subtitle?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#0d1220] p-5 sm:p-6">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm text-white/60">{subtitle}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1220] p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 text-3xl font-black tabular-nums text-white">{value}</div>
      {detail ? <div className="mt-1 text-xs text-white/55">{detail}</div> : null}
    </div>
  )
}

// ── Status: colour + icon + label, never colour alone ───────────────────────────────────────────────

const TIER_STYLE: Record<Tier, { color: string; icon: ReactNode }> = {
  strong: { color: VIZ.status.good, icon: <path d="M3 8.5l3 3 7-7" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> },
  steady: { color: 'rgba(240,239,236,0.7)', icon: <circle cx={8} cy={8} r={3.5} strokeWidth={2} fill="none" /> },
  watch: { color: VIZ.status.warning, icon: <path d="M8 3.5v5.5M8 12v.5" fill="none" strokeWidth={2.2} strokeLinecap="round" /> },
  at_risk: { color: VIZ.status.critical, icon: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" strokeWidth={2} strokeLinecap="round" /> },
}

export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier]
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/10 px-2 py-0.5 text-xs font-semibold text-white/85">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke={s.color} aria-hidden>
        {s.icon}
      </svg>
      {TIER_LABEL[tier]}
    </span>
  )
}

// ── League table: health as a single-hue meter, eight-week activity as a sparkline ────────────────

function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const W = 88
  const H = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${((i * (W - 4)) / Math.max(1, values.length - 1) + 2).toFixed(1)},${(H - 3 - ((v - min) / span) * (H - 6)).toFixed(1)}`)
  const [lx, ly] = pts[pts.length - 1]!.split(',')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-[88px]" role="img" aria-label={label}>
      <polyline points={pts.join(' ')} fill="none" stroke={VIZ.series1} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={VIZ.series1} />
    </svg>
  )
}

function HealthMeter({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: VIZ.series1 }} />
      </div>
      <span className="tabular-nums text-sm font-semibold text-white">{value}</span>
    </div>
  )
}

export function LeagueTable({ leagues, selectedId }: { leagues: readonly DemoLeague[]; selectedId: string | null }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-white/45">
            <th className="px-1 py-2 font-medium">League</th>
            <th className="px-1 py-2 font-medium">Health</th>
            <th className="px-1 py-2 font-medium">Status</th>
            <th className="px-1 py-2 font-medium">Active managers</th>
            <th className="px-1 py-2 font-medium">Activity, 8 weeks</th>
            <th className="px-1 py-2 font-medium">Open items</th>
          </tr>
        </thead>
        <tbody>
          {leagues.map((l) => {
            const trend = activityTrendPct(l.weeklyActions)
            const selected = l.id === selectedId
            return (
              <tr key={l.id} className={`border-t border-white/5 ${selected ? 'bg-white/[0.04]' : ''}`}>
                <td className="px-1 py-2.5">
                  <Link href={`/partners?league=${l.id}#league`} className="font-semibold text-cyan-300 hover:underline" aria-current={selected ? 'true' : undefined}>
                    {l.name}
                  </Link>
                  <div className="text-xs text-white/50">
                    {l.sport} · {l.format}
                  </div>
                </td>
                <td className="px-1 py-2.5">
                  <HealthMeter value={l.health} />
                </td>
                <td className="px-1 py-2.5">
                  <TierBadge tier={tierFor(l.health)} />
                </td>
                <td className="px-1 py-2.5 tabular-nums text-white/85">
                  {l.activeManagers} of {l.managers}
                </td>
                <td className="px-1 py-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkline values={l.weeklyActions} label={`${l.name} weekly actions: ${l.weeklyActions.join(', ')}`} />
                    <span className="tabular-nums text-xs text-white/70">
                      {trend > 0 ? '+' : ''}
                      {trend}%
                    </span>
                  </div>
                </td>
                <td className="px-1 py-2.5 tabular-nums text-white/85">{l.openActionItems}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── One league ─────────────────────────────────────────────────────────────────────────────────────

const WORKLOAD_LABEL = { light: 'Light', standard: 'Standard', heavy: 'Heavy' } as const

export function LeagueDrillDown({ league }: { league: DemoLeague }) {
  const tier = tierFor(league.health)
  const trend = activityTrendPct(league.weeklyActions)
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xl font-bold text-white">{league.name}</h3>
        <TierBadge tier={tier} />
        <Link href="/partners#leagues" className="ml-auto text-xs text-white/60 hover:text-white">
          Close
        </Link>
      </div>
      <p className="mt-1 text-sm text-white/55">
        {league.sport} · {league.format}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Health', `${league.health}`],
          ['Lineups set on time', `${league.lineupCompliance}%`],
          ['Trades this season', `${league.tradesThisSeason}`],
          ['Commissioner workload', WORKLOAD_LABEL[league.commissionerWorkload]],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <dt className="text-xs text-white/50">{k}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-white">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-white/65">
        {league.activeManagers} of {league.managers} managers active. Weekly actions {trend >= 0 ? 'up' : 'down'} {Math.abs(trend)}% over eight
        weeks.
      </p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-white">What needs attention</h4>
          {league.risks.length === 0 ? (
            <p className="mt-2 text-sm text-white/55">Nothing flagged this week.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {league.risks.map((r) => (
                <li key={r.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <TierBadge tier={r.severity === 'high' ? 'at_risk' : 'watch'} />
                    {r.title}
                  </div>
                  <p className="mt-1 text-sm text-white/65">{r.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white">The evidence behind the score</h4>
          <ul className="mt-2 space-y-2">
            {league.evidence.map((e) => (
              <li key={e.label} className="text-sm">
                <span className="font-semibold text-white/85">{e.label}: </span>
                <span className="text-white/65">{e.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Data quality ───────────────────────────────────────────────────────────────────────────────────

function PctMeter({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${value}%`}>
      <div className="h-2 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: VIZ.series1 }} />
      </div>
      <span className="tabular-nums text-sm text-white/85">{value}%</span>
    </div>
  )
}

export function DataQualityTable({ rows }: { rows: readonly DataQualityRow[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-white/45">
            <th className="px-1 py-2 font-medium">Source</th>
            <th className="px-1 py-2 font-medium">Leagues</th>
            <th className="px-1 py-2 font-medium">Last sync</th>
            <th className="px-1 py-2 font-medium">Synced in full</th>
            <th className="px-1 py-2 font-medium">Players matched</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.source} className="border-t border-white/5 align-top">
              <td className="px-1 py-2.5">
                <div className="font-semibold text-white">{r.source}</div>
                {r.gap ? (
                  <div className="mt-1 flex max-w-xs items-start gap-1.5 text-xs text-white/65">
                    <TierBadge tier="watch" />
                    <span>{r.gap}</span>
                  </div>
                ) : null}
              </td>
              <td className="px-1 py-2.5 tabular-nums text-white/85">{r.leagues}</td>
              <td className="px-1 py-2.5 text-white/85">{freshnessLabel(r.freshnessMinutes)}</td>
              <td className="px-1 py-2.5">
                <PctMeter value={r.coveragePct} label={`${r.source} synced in full`} />
              </td>
              <td className="px-1 py-2.5">
                <PctMeter value={r.identityPct} label={`${r.source} players matched`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── How it works ───────────────────────────────────────────────────────────────────────────────────

const FLOW: { title: string; items: string[] }[] = [
  { title: 'Your leagues', items: ['Sleeper, ESPN, Yahoo', 'MyFantasyLeague, Fantrax', 'Fleaflicker, or your own'] },
  { title: 'League sync', items: ['Rosters, scores, trades', 'One identity per player', 'Freshness tracked per source'] },
  { title: 'League Intelligence', items: ['Lineups, waivers, trades', 'Drafts, league health', 'Every call logged with its outcome'] },
  { title: 'Delivered to you', items: ['Versioned API (v1)', 'Embeddable widgets', 'Per-tenant keys and limits'] },
]

export function HowItWorksFlow() {
  return (
    <ol className="grid gap-3 md:grid-cols-4" aria-label="How data flows">
      {FLOW.map((step, i) => (
        <li key={step.title} className="relative rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-xs font-semibold text-cyan-300">Step {i + 1}</div>
          <div className="mt-0.5 font-bold text-white">{step.title}</div>
          <ul className="mt-2 space-y-1 text-sm text-white/65">
            {step.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
          {i < FLOW.length - 1 ? (
            <span aria-hidden className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-white/40 md:-right-3 md:bottom-auto md:left-auto md:top-1/2 md:-translate-y-1/2 md:translate-x-0">
              <span className="md:hidden">↓</span>
              <span className="hidden md:inline">→</span>
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

const TIER_ORDER = ['standard', 'premium', 'enterprise'] as const
const MODE_LABEL: Record<string, string> = {
  compact: 'Compact card',
  popup: 'Pop-up',
  mobile: 'Mobile',
  sidebar: 'Sidebar',
  commissioner: 'Commissioner view',
  manager: 'Manager view',
  partner: 'Partner view',
  full_dashboard: 'Full dashboard',
}

/** The widget catalog, read from the SDK's own permission table so this page can never promise a mode the license cannot embed. */
export function WidgetCatalog() {
  const byTier = TIER_ORDER.map((t) => ({
    tier: t,
    modes: Object.entries(WIDGET_MODE_MIN_TIER)
      .filter(([, min]) => min === t)
      .map(([mode]) => MODE_LABEL[mode] ?? mode),
  }))
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {byTier.map(({ tier, modes }, i) => (
        <div key={tier} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-sm font-bold capitalize text-white">{tier}</div>
          <div className="mt-0.5 text-xs text-white/50">{i === 0 ? 'Includes' : `Everything in ${TIER_ORDER[i - 1]}, plus`}</div>
          <ul className="mt-2 space-y-1 text-sm text-white/75">
            {modes.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
