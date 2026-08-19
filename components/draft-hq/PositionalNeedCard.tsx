/**
 * Draft HQ — Positional need.
 *
 * The card the design describes: one bar per starting position, high = solved, with the
 * `?` explaining what the engine weights. Presentational only — it receives the view
 * built by `buildPositionalNeedView` and paints it.
 *
 * ⚠ IT WILL RENDER "—" RATHER THAN A NUMBER, AND THAT IS THE POINT. The recommendation
 * engine only scores positions it assessed. A position it never looked at has no score,
 * and drawing a full green bar there would claim the position is solved on the strength
 * of nothing. Unknown reads as unknown.
 */
'use client'

import type { PositionalNeedView } from '@/lib/draft-helper/positionalNeedView'

type Props = {
  view: PositionalNeedView
  /** Shown while the engine is still computing, so an empty card is never mistaken for a verdict. */
  loading?: boolean
}

export function PositionalNeedCard({ view, loading = false }: Props) {
  return (
    <section
      className="af-dhq-card"
      aria-labelledby="dhq-need-heading"
      style={{
        background: 'var(--surface2, #12161f)',
        border: '1px solid var(--rule, rgba(255,255,255,.08))',
        borderRadius: 12,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3
          id="dhq-need-heading"
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #7e8894)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          }}
        >
          Positional need
        </h3>
        <button
          type="button"
          aria-label="What positional need means"
          title="What the engine weights when it ranks players for you — a low score means the position is a hole, a high score means it is solved."
          style={{
            width: 16, height: 16, borderRadius: '50%', lineHeight: '14px',
            fontSize: 10, fontWeight: 700, cursor: 'help',
            border: '1px solid var(--rule-2, rgba(255,255,255,.16))',
            background: 'transparent', color: 'var(--ink-3, #7e8894)',
          }}
        >
          ?
        </button>
      </header>

      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3, #7e8894)' }}>
          Scoring this league’s roster…
        </p>
      ) : view.empty ? (
        /*
         * Not "every position is fine" — nothing was assessable. Saying so beats four
         * grey bars the reader has to interpret.
         */
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3, #7e8894)' }}>
          No positions scored yet. Need is computed from this league’s starting slots and
          your current roster, so it fills in once the roster is synced.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {view.rows.map((row) => (
            <li key={row.position} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  minWidth: 34,
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '.06em',
                  color: `var(${row.token}, #7e8894)`,
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                }}
              >
                {row.position}
              </span>

              <div
                role="img"
                aria-label={
                  row.solved === null
                    ? `${row.position}: not scored`
                    : `${row.position}: ${row.solved} of 100 solved`
                }
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 999,
                  background: 'var(--chip, rgba(255,255,255,.06))',
                  overflow: 'hidden',
                }}
              >
                {row.solved !== null && (
                  <div
                    style={{
                      width: `${row.solved}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: `var(${row.token})`,
                    }}
                  />
                )}
              </div>

              <span
                style={{
                  minWidth: 26,
                  textAlign: 'right',
                  fontSize: 13,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  color: row.solved === null ? 'var(--ink-3, #7e8894)' : `var(${row.token})`,
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                }}
              >
                {row.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {view.caveat && (
        /* Board-level thinness, stated rather than folded into the bars. */
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3, #7e8894)' }}>
          {view.caveat}
        </p>
      )}
    </section>
  )
}

export default PositionalNeedCard
