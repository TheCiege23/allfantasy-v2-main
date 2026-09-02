import type { AdminCommandCenterMetrics, AdminMetric } from '@/lib/admin-dashboard/AdminCommandCenterService'
import { buildAdminVerdict, buildPeerGroups, type AdminPeerGroup } from '@/lib/admin-dashboard/adminVerdict'

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
 *
 * Styling comes from `app/admin/command-center.css`, whose tokens are scoped to
 * `.af-cc` rather than `:root` — see that file's header for why copying the
 * handoff's `tokens.css` verbatim into the document root would repaint the
 * whole app.
 */

/**
 * The scope label in each card's header. The handoff fixes this copy per group
 * ("ALL TIME" / "STRIPE" / "LIVE"), so it is a mapping rather than data —
 * `AdminPeerGroup.hint` is a sentence and reads badly as a header chip. The
 * hint is not discarded: it becomes each card's accessible name below.
 */
const GROUP_SCOPE: Record<AdminPeerGroup['id'], string> = {
  people: 'All time',
  money: 'Stripe',
  now: 'Live',
}

function MetricRow({ item, lead, group }: { item: AdminMetric; lead: boolean; group: AdminPeerGroup['id'] }) {
  /*
   * ⚠ THE UNTRACKED BRANCH MUST NOT RENDER `item.value`. An unmeasured metric
   * has no number to show, and printing one — even a zero — is exactly the
   * confusion this shape exists to prevent.
   */
  if (!item.tracked) {
    return (
      <div className="af-cc-untracked">
        <div className="af-cc-untracked-text">
          <div className="af-cc-untracked-label">{item.label}</div>
          {item.note ? <div className="af-cc-untracked-reason">{item.note}</div> : null}
        </div>
        <div className="af-cc-untracked-chip">Not tracked</div>
      </div>
    )
  }

  const valueClass = [
    'af-cc-metric-value',
    lead ? 'af-cc-metric-value--lead' : '',
    lead && group === 'now' ? 'af-cc-metric-value--good' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="af-cc-metric">
      <div className="af-cc-stack af-cc-metric-label">
        <span>{item.label}</span>
        {item.note ? <span className="af-cc-cell-faint">{item.note}</span> : null}
      </div>
      <div className={valueClass}>{item.value}</div>
    </div>
  )
}

export function AdminCommandCenterOverview({ metrics }: { metrics: AdminCommandCenterMetrics }) {
  const verdict = buildAdminVerdict(metrics)
  const groups = buildPeerGroups(metrics)
  const untrackedMoney = groups.find((g) => g.id === 'money')?.metrics.filter((m) => !m.tracked).length ?? 0
  const others = verdict.issues.slice(1)
  const criticalCount = verdict.issues.filter((i) => i.severity === 'critical').length
  const warnCount = verdict.issues.length - criticalCount

  return (
    <section aria-label="Command Center overview" className="af-cc-stack" style={{ gap: 16 }}>
      {/* ── The verdict ─────────────────────────────────────────────────── */}
      <div className="af-cc-verdict">
        <div className={verdict.ok ? 'af-cc-verdict-main' : 'af-cc-verdict-main af-cc-verdict-main--bad'}>
          <span className="af-cc-dot" aria-hidden="true" />
          <div className="af-cc-verdict-text">
            <div className="af-cc-verdict-head">{verdict.headline}</div>
            <div className="af-cc-verdict-evidence">
              {verdict.ok
                ? 'Every configured provider is reporting · every scheduled job is wired · no critical environment variable is missing'
                : [
                    criticalCount ? `${criticalCount} critical` : '',
                    warnCount ? `${warnCount} warning${warnCount === 1 ? '' : 's'}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </div>
          </div>
        </div>

        {/*
          The handoff's right-hand panel. It exists only when something is
          actually wrong — an empty "0 things need you" box is chrome, and 29a's
          whole argument is that this strip answers a question rather than
          decorating one.
        */}
        {verdict.lead ? (
          <a
            href={verdict.lead.anchor}
            className={
              verdict.lead.severity === 'critical' ? 'af-cc-needs af-cc-needs--critical' : 'af-cc-needs'
            }
          >
            <span className="af-cc-needs-mark" aria-hidden="true">
              {verdict.lead.severity === 'critical' ? '!' : '⚠'}
            </span>
            {/*
              ⚠ THE COUNT LIVES ON THE LEFT, NOT HERE. `verdict.headline` is
              already "N things need you"; repeating it here spends the one
              panel that can name the actual problem on saying the same thing
              twice. So this side carries the lead issue's title and its
              consequence — which is the blast radius, not a restatement.
            */}
            <span className="af-cc-verdict-text">
              <span className="af-cc-needs-title">{verdict.lead.title}</span>
              <span className="af-cc-needs-detail">{verdict.lead.consequence}</span>
            </span>
          </a>
        ) : null}
      </div>

      {others.length ? (
        <details className="af-cc-more">
          <summary className="af-cc-more-summary">The other {others.length}</summary>
          <ul className="af-cc-more-list">
            {others.map((issue) => (
              <li key={issue.id}>
                <a href={issue.anchor} className="af-cc-more-link">
                  <span
                    className={
                      issue.severity === 'critical'
                        ? 'af-cc-more-bullet af-cc-more-bullet--critical'
                        : 'af-cc-more-bullet'
                    }
                    aria-hidden="true"
                  >
                    ·
                  </span>
                  <b>{issue.title}</b> {issue.consequence}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* ── Three peer groups ───────────────────────────────────────────── */}
      <div className="af-cc-grid3">
        {groups.map((group) => (
          <section key={group.id} className="af-cc-card" aria-label={`${group.label} — ${group.hint}`}>
            <div className="af-cc-card-head">
              <div className="af-cc-card-title">{group.label}</div>
              <div className={group.id === 'now' ? 'af-cc-card-scope af-cc-card-scope--live' : 'af-cc-card-scope'}>
                {GROUP_SCOPE[group.id]}
              </div>
            </div>
            <div className="af-cc-card-body">
              {group.metrics.length ? (
                group.metrics.map((item, i) => (
                  <MetricRow key={`${group.id}-${item.label}-${i}`} item={item} lead={i === 0} group={group.id} />
                ))
              ) : (
                <div className="af-cc-empty">Nothing reported in this group.</div>
              )}

              {group.id === 'money' && untrackedMoney > 0 ? (
                <p className="af-cc-footnote">
                  {untrackedMoney} of these are not instrumented. They are shown as NOT TRACKED rather than as a
                  zero on purpose — an unmeasured number and a real zero are different readings and must not look
                  alike.
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
