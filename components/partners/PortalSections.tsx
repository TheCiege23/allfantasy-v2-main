import Link from 'next/link'
import type { ReactNode } from 'react'
import { TierBadge } from '@/components/partners/PartnerSections'
import { VIZ } from '@/components/partners/vizTokens'
import { freshnessLabel } from '@/lib/partner-portal/demoTenant'
import type { PartnerRecord, PortalLeague, PortalSource } from '@/lib/partner-portal/workspace'

/** The API's health statuses, shown with the same icon-plus-word badge as the demo (never colour alone). */
const STATUS: Record<PortalLeague['status'], { tier: 'strong' | 'steady' | 'watch' | 'at_risk'; label: string }> = {
  healthy: { tier: 'strong', label: 'Healthy' },
  cooling: { tier: 'watch', label: 'Cooling' },
  stale: { tier: 'at_risk', label: 'Stale' },
  unknown: { tier: 'steady', label: 'No activity yet' },
}

export function StatusBadge({ status }: { status: PortalLeague['status'] }) {
  return <TierBadge tier={STATUS[status].tier} label={STATUS[status].label} />
}

export function PortalNotice({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d1220] p-6 sm:p-8">
      <h2 className="text-xl font-bold text-white">{title}</h2>
      <div className="mt-2 max-w-2xl text-sm leading-relaxed text-white/65">{children}</div>
      {action ? <div className="mt-5 flex flex-wrap gap-3">{action}</div> : null}
    </section>
  )
}

function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
}

export function PortalLeagueTable({ leagues }: { leagues: PortalLeague[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-white/45">
            <th className="px-1 py-2 font-medium">League</th>
            <th className="px-1 py-2 font-medium">Health</th>
            <th className="px-1 py-2 font-medium">Status</th>
            <th className="px-1 py-2 font-medium">Active managers</th>
            <th className="px-1 py-2 font-medium">Last activity</th>
            <th className="px-1 py-2 font-medium">Needs attention</th>
          </tr>
        </thead>
        <tbody>
          {leagues.map((l) => {
            const items = l.actionItems.filter((i) => i.severity !== 'info')
            return (
              <tr key={l.leagueId} className="border-t border-white/5 align-top">
                <td className="px-1 py-2.5">
                  <div className="font-semibold text-white">{l.name}</div>
                  <div className="text-xs text-white/50">
                    {[l.sport, l.provider].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-1 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-white/10" aria-hidden>
                      <div className="h-full rounded-full" style={{ width: `${l.healthScore}%`, background: VIZ.series1 }} />
                    </div>
                    <span className="tabular-nums text-sm font-semibold text-white">{l.healthScore}</span>
                  </div>
                </td>
                <td className="px-1 py-2.5">
                  <StatusBadge status={l.status} />
                </td>
                <td className="px-1 py-2.5 tabular-nums text-white/85">
                  {l.totalManagers ? `${l.activeManagers} of ${l.totalManagers}` : '—'}
                </td>
                <td className="px-1 py-2.5 text-white/85">
                  {l.daysSinceLastActivity == null ? 'None yet' : l.daysSinceLastActivity === 0 ? 'Today' : `${l.daysSinceLastActivity} d ago`}
                </td>
                <td className="px-1 py-2.5 text-xs text-white/70">
                  {items.length === 0 ? (
                    <span className="text-white/45">Nothing flagged</span>
                  ) : (
                    <ul className="space-y-1">
                      {items.map((i) => (
                        <li key={i.kind}>{i.message}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function PortalSourcesTable({ sources, now }: { sources: PortalSource[]; now: Date }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-white/45">
            <th className="px-1 py-2 font-medium">Source</th>
            <th className="px-1 py-2 font-medium">Leagues</th>
            <th className="px-1 py-2 font-medium">Oldest sync</th>
            <th className="px-1 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => {
            const mins = minutesSince(s.lastSyncedAt, now)
            return (
              <tr key={s.provider} className="border-t border-white/5 align-top">
                <td className="px-1 py-2.5 font-semibold capitalize text-white">{s.provider}</td>
                <td className="px-1 py-2.5 tabular-nums text-white/85">{s.leagues}</td>
                <td className="px-1 py-2.5 text-white/85">
                  {mins == null ? 'Never synced' : freshnessLabel(mins)}
                  {s.neverSynced > 0 && mins != null ? <div className="text-xs text-white/55">{s.neverSynced} not synced yet</div> : null}
                </td>
                <td className="px-1 py-2.5">
                  {s.degraded > 0 ? (
                    <div className="flex flex-col gap-1">
                      <TierBadge tier="watch" label={`${s.degraded} degraded`} />
                      {s.reason ? <span className="text-xs text-white/60">{s.reason}</span> : null}
                    </div>
                  ) : (
                    <TierBadge tier="strong" label="OK" />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function DemoLink() {
  return (
    <Link href="/partners#demo" className="rounded-xl border border-white/20 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/5">
      See the demo
    </Link>
  )
}

// ── Recommendation record ───────────────────────────────────────────────────────────────────────────

/**
 * Right / same / wrong as one segmented bar. Identity colours (categorical slots, not status colours), a 2px
 * surface gap between segments, and a legend that carries the counts in text so nothing is colour-alone.
 */
function OutcomeBar({ right, same, wrong }: { right: number; same: number; wrong: number }) {
  const total = right + same + wrong
  const parts = [
    { key: 'right', label: 'Recommended player scored more', n: right, color: VIZ.series1 },
    { key: 'same', label: 'Within a point', n: same, color: VIZ.neutral },
    { key: 'wrong', label: 'Benched player scored more', n: wrong, color: VIZ.series2 },
  ]
  if (total === 0) return null
  return (
    <div>
      <div
        role="img"
        aria-label={`${right} recommended player scored more, ${same} within a point, ${wrong} benched player scored more`}
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded"
      >
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <div key={p.key} style={{ width: `${(100 * p.n) / total}%`, background: p.color }} />
          ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-xs text-white/70">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="flex-1">{p.label}</span>
            <span className="tabular-nums text-white">{p.n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RecordBlock({ heading, value, detail, children }: { heading: string; value: string; detail: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="text-sm font-semibold text-white">{heading}</h3>
      <div className="mt-2 text-3xl font-black tabular-nums text-white">{value}</div>
      <p className="mt-1 text-xs text-white/60">{detail}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function RecommendationRecord({ record, unavailable }: { record: PartnerRecord | null; unavailable: boolean }) {
  if (unavailable) {
    return <p className="text-sm text-white/60">The record couldn&apos;t be read just now. Your leagues and their data are unaffected; try again later.</p>
  }
  if (!record) {
    return (
      <p className="text-sm text-white/60">
        No lineup or pickup recommendations have been given in your linked leagues this NFL season yet. They appear here, graded, once their games
        are played.
      </p>
    )
  }
  const s = record.startSit
  const p = record.pickups
  const decided = s ? s.right + s.wrong : 0
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {s ? (
          <RecordBlock
            heading="Start / sit"
            value={s.ratePct != null ? `${s.ratePct}%` : plural(s.right + s.wrong + s.same, 'call', 'calls')}
            detail={
              s.ratePct != null
                ? `of ${decided} decided calls, the recommended starter out-scored the player benched` +
                  (s.gainPerCall != null ? ` · ${s.gainPerCall >= 0 ? '+' : ''}${s.gainPerCall} pts per call` : '')
                : `graded so far. A rate shows once ${record.minSample} calls are decided (${decided} now).`
            }
          >
            <OutcomeBar right={s.right} same={s.same} wrong={s.wrong} />
            {s.pending ? <p className="mt-3 text-xs text-white/50">{plural(s.pending, 'call is', 'calls are')} waiting on games.</p> : null}
          </RecordBlock>
        ) : null}
        {p ? (
          <RecordBlock
            heading="Waiver pickups"
            value={p.ratePct != null ? `${p.ratePct}%` : plural(p.graded, 'pickup', 'pickups')}
            detail={
              p.ratePct != null
                ? `of ${p.graded} top pickups averaged 10+ PPR over that week and the next two`
                : `graded so far. A rate shows once ${record.minSample} are graded.`
            }
          >
            <ul className="space-y-1.5 text-xs text-white/70">
              <li className="flex justify-between gap-3">
                <span>Averaged 10+ PPR a week</span>
                <span className="tabular-nums text-white">
                  {p.startable} of {p.graded}
                </span>
              </li>
              {p.vsDrop ? (
                <li className="flex justify-between gap-3">
                  <span>Out-scored the suggested drop</span>
                  <span className="tabular-nums text-white">
                    {p.beatDrop} of {p.vsDrop}
                  </span>
                </li>
              ) : null}
            </ul>
            {p.pending ? <p className="mt-3 text-xs text-white/50">{plural(p.pending, 'pickup is', 'pickups are')} still inside the three-week window.</p> : null}
          </RecordBlock>
        ) : null}
      </div>
      {record.trades?.length ? (
        <RecordBlock heading="Trade grades, checked later" value={plural(record.trades.reduce((n, b) => n + b.letters.reduce((m, t) => m + t.n, 0), 0), 'trade', 'trades')} detail="graded in your leagues, then checked against what happened — points under each league's own scoring, or dynasty value a month on">
          <ul className="space-y-1.5 text-xs text-white/70">
            {record.trades.flatMap((b) =>
              b.letters.map((t) => (
                <li key={`${b.key}-${t.letter}`} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {b.sport} · graded {t.letter}
                    {b.kind === 'value' ? ' (dynasty value)' : b.kind === 'categories' ? ' (categories)' : ''}
                  </span>
                  <span className="tabular-nums text-white">
                    {t.net >= 0 ? '+' : '−'}
                    {Math.abs(t.net).toFixed(1)} {b.kind === 'value' ? 'value' : b.kind === 'categories' ? 'cats' : 'pts/wk'} · {t.n} trades{t.aheadPct != null ? ` · ahead ${t.aheadPct}%` : ''}
                  </span>
                </li>
              )),
            )}
          </ul>
        </RecordBlock>
      ) : null}
      <p className="text-xs text-white/45">
        {record.season} NFL season, through week {record.throughWeek}. Start/sit is graded on each league&apos;s own scoring; pickups on standard
        PPR. Counts only — no manager is identified.
      </p>
    </div>
  )
}
