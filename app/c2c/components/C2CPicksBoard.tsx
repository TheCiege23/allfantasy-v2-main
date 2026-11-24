'use client'

export type C2CPickRow = {
  id: string
  pickSide: string
  season: number
  round: number
  originalOwnerId: string
  currentOwnerId: string
  isUsed: boolean
}

/**
 * Your future picks, each listed once (2026-11-23). A row says the round and year; it names a team only when the
 * pick came from someone else ("via Gridiron Graduates"), and "Used" only once it is. The section heading already
 * says Campus or Canton, and the old disabled "Trade" button did nothing, so neither repeats on every row.
 */
export function C2CPicksBoard({
  picks,
  format,
  teamLabel,
}: {
  picks: C2CPickRow[]
  format: 'combined' | 'separate_campus_and_canton' | string
  teamLabel?: (rosterId: string) => string
}) {
  const sep = format === 'separate_campus_and_canton' || String(format).includes('separate')
  const campusPicks = picks.filter((p) => p.pickSide === 'campus')
  const cantonPicks = picks.filter((p) => p.pickSide === 'canton')
  const combined = picks.filter((p) => p.pickSide === 'combined' || (!sep && p.pickSide !== 'campus' && p.pickSide !== 'canton'))

  function PickRow({ p }: { p: C2CPickRow }) {
    const via = p.originalOwnerId !== p.currentOwnerId ? (teamLabel ? teamLabel(p.originalOwnerId) : 'another team') : null
    return (
      <li
        className="flex min-h-[44px] items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-2 text-[13px] first:border-t-0"
        data-testid={`c2c-pick-row-${p.id}`}
      >
        <span className="font-semibold text-[var(--text)]">
          Round {p.round} <span className="font-normal text-[var(--muted)]">· {p.season}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-[12px]">
          {via ? <span className="truncate text-[var(--text2)]">via {via}</span> : null}
          {p.isUsed ? <span className="rounded-full bg-[var(--good-soft)] px-2 py-0.5 font-bold text-[var(--good)]">Used</span> : null}
        </span>
      </li>
    )
  }

  const Section = ({ title, rows, tone, testId }: { title: string; rows: C2CPickRow[]; tone: 'campus' | 'canton' | 'both'; testId: string }) => (
    <section data-testid={testId}>
      <h3 className={`mb-2 text-[13px] font-bold ${tone === 'campus' ? 'text-[var(--campus)]' : tone === 'canton' ? 'text-[var(--canton)]' : 'text-[var(--text)]'}`}>
        {title} <span className="font-normal text-[var(--muted)]">· {rows.length}</span>
      </h3>
      {rows.length ? (
        <ul className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          {rows.map((p) => (
            <PickRow key={p.id} p={p} />
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-[var(--muted)]">No picks.</p>
      )}
    </section>
  )

  if (sep) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="🎓 Campus picks" rows={campusPicks} tone="campus" testId="c2c-picks-campus" />
        <Section title="🏙 Canton picks" rows={cantonPicks} tone="canton" testId="c2c-picks-canton" />
      </div>
    )
  }

  return <Section title="Your picks" rows={combined.length ? combined : picks} tone="both" testId="c2c-picks-combined" />
}
