'use client'

/**
 * "Top outstanding issues" — the live dashboard's per-league alert list (rendered by NocturneDashboard).
 * Each row is an INTERNAL AllFantasy analysis launcher (opens the wired action modal for its normalized
 * `kind` — never display text) plus, for an imported + resolvable league, a compact SECURE external
 * source-platform action. The external link is the one the today-actions route already resolved
 * SERVER-SIDE from the canonical League row (`iss.external`) — this component never builds or trusts a
 * client URL. The read-only disclosure renders ONCE per card, only when an imported league has an
 * external action.
 */
import { SourceActionLink, ReadOnlyLeagueNote } from '@/components/league-links/SourceActionLink'
import type { OutstandingIssueRow, OutstandingIssueKind } from '@/lib/dashboard/outstanding-issues'

export function OutstandingIssuesCard({
  issues,
  scopeLabel,
  onOpen,
}: {
  issues: OutstandingIssueRow[]
  /** e.g. a filtered league name, or "all leagues". */
  scopeLabel: string
  /** Open the internal AllFantasy analysis modal for this normalized kind. */
  onOpen: (kind: OutstandingIssueKind) => void
}) {
  if (issues.length === 0) return null
  const showDisclosure = issues.some((i) => i.imported && i.external)

  return (
    <div>
      <div className="dash-kicker" style={{ marginBottom: 12 }}>
        Top {issues.length} outstanding issue{issues.length > 1 ? 's' : ''} — {scopeLabel}
      </div>
      <div className="afcard" style={{ padding: 6 }}>
        {issues.map((iss) => (
          <div key={iss.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-md)' }}>
            {/* Row → internal AllFantasy analysis: opens the same wired modal the priorities launch
                (internal nav stays pro-gated inside the modal). */}
            <button
              type="button"
              onClick={() => onOpen(iss.kind)}
              title="Review in AllFantasy"
              style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
              <span
                aria-hidden
                style={{
                  width: 8, height: 8, borderRadius: '50%', flex: 'none',
                  background: iss.severity === 'critical' ? '#e5675f' : iss.severity === 'warning' ? '#d8a657' : 'var(--color-accent-500)',
                }}
              />
              <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{iss.label}</span>
              {iss.count > 1 && <span className="tag tag-neutral" style={{ flex: 'none' }}>×{iss.count}</span>}
              <span style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', flex: 'none', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{iss.league}</span>
            </button>
            {/* Secure external source action — pre-resolved + validated SERVER-SIDE by the route (imported +
                resolvable leagues only); honest "Go to {provider}" on a homepage fallback. */}
            {iss.external ? (
              <SourceActionLink
                link={iss.external.link}
                label={iss.external.label}
                className=""
                style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 'var(--radius-sm, 8px)', border: '1px solid var(--color-neutral-800)', color: 'var(--color-accent-400)', fontSize: 11.5, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', maxWidth: 190 }}
              />
            ) : null}
          </div>
        ))}
      </div>
      {showDisclosure ? (
        <ReadOnlyLeagueNote style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-neutral-600)' }} />
      ) : null}
    </div>
  )
}
