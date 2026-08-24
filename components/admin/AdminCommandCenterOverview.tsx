import type { AdminCommandCenterMetrics, AdminMetric } from '@/lib/admin-dashboard/AdminCommandCenterService'
import { buildAdminVerdict, buildPeerGroups } from '@/lib/admin-dashboard/adminVerdict'

/**
 * 29a — the Command Center overview: a verdict, then three peer groups.
 *
 * ⚠ THE VERDICT LEADS THE PAGE. Numbers below it, never above. The whole point
 * of 29a is that an operator opening /admin learns whether anything is wrong
 * before they learn anything else; the previous page opened with a metric wall
 * and made them derive it.
 *
 * ⚠ "$0" AND "NOT TRACKED" RENDER DIFFERENTLY, DELIBERATELY. `tracked: false`
 * gets its own muted, dashed treatment and the words "NOT TRACKED" — never a
 * zero. A measured zero is information ("nobody paid today"); an unmeasured one
 * is the absence of information, and showing both as $0.00 is how an operator
 * comes to believe a broken meter is a quiet day.
 *
 * ⚠ EVERY ISSUE LINKS SOMEWHERE THAT EXISTS. The anchors here (#providers,
 * #crons, #env) are rendered by the admin page below. A verdict that names a
 * problem and then strands the reader is worse than no verdict.
 */

function MetricRow({ item }: { item: AdminMetric }) {
  if (!item.tracked) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300/25 bg-amber-200/[0.04] px-3 py-2.5">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-100/50">
          {item.label}
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-200/80">
          Not tracked
        </div>
        {item.note ? <div className="mt-0.5 text-[11px] text-white/35">{item.note}</div> : null}
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/55">
        {item.label}
      </div>
      <div className="mt-1 text-lg font-black leading-tight text-white">{item.value}</div>
      {item.note ? <div className="mt-0.5 text-[11px] text-white/40">{item.note}</div> : null}
    </div>
  )
}

export function AdminCommandCenterOverview({ metrics }: { metrics: AdminCommandCenterMetrics }) {
  const verdict = buildAdminVerdict(metrics)
  const groups = buildPeerGroups(metrics)
  const untrackedMoney = groups.find((g) => g.id === 'money')?.metrics.filter((m) => !m.tracked).length ?? 0

  return (
    <section aria-label="Command Center overview" className="mb-8 space-y-5">
      {/* ── The verdict ─────────────────────────────────────────────────── */}
      <div
        className={
          verdict.ok
            ? 'rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] p-5'
            : 'rounded-2xl border border-rose-300/30 bg-rose-500/[0.08] p-5'
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className={
              verdict.ok
                ? 'text-2xl font-black tracking-tight text-emerald-200'
                : 'text-2xl font-black tracking-tight text-rose-200'
            }
          >
            {verdict.headline}
          </span>
          <span className="text-[11px] uppercase tracking-[0.16em] text-white/35">
            checked {new Date(metrics.generatedAt).toLocaleTimeString()}
          </span>
        </div>

        {verdict.lead ? (
          <a
            href={verdict.lead.anchor}
            className="mt-3 block rounded-xl border border-white/10 bg-black/25 px-4 py-3 transition hover:border-white/25"
          >
            <div className="flex items-center gap-2">
              <span
                className={
                  verdict.lead.severity === 'critical'
                    ? 'rounded bg-rose-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-rose-950'
                    : 'rounded bg-amber-300 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-amber-950'
                }
              >
                {verdict.lead.severity === 'critical' ? 'Critical' : 'Warning'}
              </span>
              <span className="text-sm font-bold text-white">{verdict.lead.title}</span>
            </div>
            <div className="mt-1 text-xs text-white/55">{verdict.lead.consequence}</div>
          </a>
        ) : (
          <p className="mt-2 text-xs text-white/50">
            Every configured provider is reporting, every scheduled job is wired, and no critical
            environment variable is missing.
          </p>
        )}

        {verdict.issues.length > 1 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
              The other {verdict.issues.length - 1}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {verdict.issues.slice(1).map((issue) => (
                <li key={issue.id}>
                  <a href={issue.anchor} className="block text-xs text-white/65 hover:text-white">
                    <span
                      className={
                        issue.severity === 'critical'
                          ? 'mr-2 font-black text-rose-300'
                          : 'mr-2 font-black text-amber-300'
                      }
                    >
                      ·
                    </span>
                    <span className="font-semibold">{issue.title}</span>{' '}
                    <span className="text-white/40">{issue.consequence}</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {/* ── Three peer groups ───────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-white/70">
              {group.label}
            </div>
            <div className="mb-3 text-[11px] text-white/35">{group.hint}</div>
            <div className="space-y-2">
              {group.metrics.length ? (
                group.metrics.map((item, i) => <MetricRow key={`${group.id}-${item.label}-${i}`} item={item} />)
              ) : (
                <div className="rounded-xl border border-dashed border-white/12 px-3 py-3 text-[11px] text-white/35">
                  Nothing reported in this group.
                </div>
              )}
            </div>
            {group.id === 'money' && untrackedMoney > 0 ? (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-100/50">
                {untrackedMoney} of these are not instrumented. They are shown as NOT TRACKED rather
                than as a zero on purpose — an unmeasured number and a real zero are different
                readings and must not look alike.
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}
