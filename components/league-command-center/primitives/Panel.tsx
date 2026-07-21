import type { ReactNode } from 'react'

/**
 * Command Center panel chrome + the small display primitives every section
 * reuses. Kept in one file (the same shape as `DecisionOsCardPrimitives.tsx`)
 * so a section imports one module rather than six.
 */

export interface PanelProps {
  title?: string
  subtitle?: string
  /** Rendered on the title row, right-aligned — filters, toggles, counts. */
  actions?: ReactNode
  children: ReactNode
  className?: string
  tight?: boolean
}

export function Panel({ title, subtitle, actions, children, className, tight }: PanelProps) {
  const classes = ['af-cc-panel', tight ? 'af-cc-panel--tight' : null, className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes}>
      {title || actions ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: subtitle ? 4 : 14,
          }}
        >
          {title ? <h2 className="af-cc-panel__title" style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions ?? null}
        </div>
      ) : null}
      {subtitle ? <p className="af-cc-panel__subtitle">{subtitle}</p> : null}
      {children}
    </section>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export type BadgeTone = 'brand' | 'neutral' | 'ops' | 'good' | 'warn' | 'bad'

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone
  icon?: string
  children: ReactNode
}) {
  return (
    <span className={`af-cc-badge af-cc-badge--${tone}`}>
      {icon ? <i className={`ph ${icon}`} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

// ── Key/value rows ────────────────────────────────────────────────────────────

export interface KeyValueRow {
  label: string
  /** `null` renders an em dash — the honest representation of "we do not know". */
  value: ReactNode | null
  tone?: 'default' | 'good' | 'warn' | 'bad'
}

const TONE_COLOR: Record<NonNullable<KeyValueRow['tone']>, string | undefined> = {
  default: undefined,
  good: 'var(--cc-good)',
  warn: 'var(--cc-ops)',
  bad: 'var(--cc-bad)',
}

export function KeyValueList({ rows }: { rows: readonly KeyValueRow[] }) {
  return (
    <dl className="af-cc-kv" style={{ margin: 0 }}>
      {rows.map((row) => (
        <div className="af-cc-kv__row" key={row.label}>
          <dt className="af-cc-kv__k">{row.label}</dt>
          <dd
            className="af-cc-kv__v"
            style={{ margin: 0, color: TONE_COLOR[row.tone ?? 'default'] }}
          >
            {row.value === null || row.value === undefined ? (
              <span className="af-cc-muted" title="Not available">
                —
              </span>
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ── Empty states ──────────────────────────────────────────────────────────────

export function EmptyState({
  icon = 'ph-tray',
  title,
  body,
  action,
}: {
  icon?: string
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="af-cc-empty">
      <i className={`ph ${icon}`} aria-hidden="true" />
      <div className="af-cc-empty__title">{title}</div>
      {body ? <p className="af-cc-empty__body">{body}</p> : null}
      {action ?? null}
    </div>
  )
}

/**
 * Explicit "this tab is not built yet" state.
 *
 * Distinct from `EmptyState` on purpose: an unbuilt surface must never render
 * the same way as a built surface with no data. "No trades yet" and "the Trades
 * tab does not exist yet" are different facts, and conflating them makes the
 * product look broken instead of incomplete.
 */
export function NotBuiltState({
  sectionLabel,
  fallbackHref,
}: {
  sectionLabel: string
  fallbackHref?: string
}) {
  return (
    <Panel>
      <EmptyState
        icon="ph-hammer"
        title={`${sectionLabel} is not in the Command Center yet`}
        body={
          'This section has not been rebuilt on the Command Center yet. ' +
          'Nothing is missing from your league — the existing league page still has it.'
        }
        action={
          fallbackHref ? (
            <a className="af-cc-action" href={fallbackHref}>
              <i className="ph ph-arrow-right" aria-hidden="true" />
              Open it on the league page
            </a>
          ) : null
        }
      />
    </Panel>
  )
}

// ── Degradation notice ────────────────────────────────────────────────────────

/**
 * Renders loader warnings rather than hiding them. Canonical World exposes
 * `completeness.warnings` / `unsupported` precisely so surfaces can be honest
 * about gaps; swallowing them turns "we could not load this" into "this is
 * zero", which is the more damaging error.
 */
export function DegradationNotice({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null

  return (
    <div
      className="af-cc-trust"
      role="status"
      style={{ borderColor: 'var(--cc-ops-edge)', color: 'var(--cc-text-3)' }}
    >
      <i className="ph ph-info" style={{ color: 'var(--cc-ops)' }} aria-hidden="true" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {warnings.map((warning) => (
          <span key={warning}>{warning}</span>
        ))}
      </div>
    </div>
  )
}
