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
    const sideClass =
      p.pickSide === 'campus'
        ? 'border-violet-500/40 bg-violet-600/15'
        : p.pickSide === 'canton'
          ? 'border-blue-500/40 bg-blue-600/15'
          : 'border-white/[0.08] bg-gradient-to-r from-violet-600/20 to-blue-600/20'
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] ${sideClass}`}
        data-testid={`c2c-pick-row-${p.id}`}
      >
        <span className="font-mono text-white/90">
          R{p.round} · {p.season}
        </span>
        <span className="uppercase text-white/55">{p.pickSide}</span>
        <span className="text-white/70">{teamLabel ? teamLabel(p.currentOwnerId) : p.currentOwnerId.slice(0, 8)}</span>
        <span className={p.isUsed ? 'text-emerald-300' : 'text-amber-200/80'}>{p.isUsed ? 'Used' : 'Available'}</span>
        <button type="button" disabled className="text-[11px] text-cyan-300/50">
          Trade
        </button>
      </div>
    )
  }

  if (sep) {
    return (
      <div className="space-y-6">
        <section data-testid="c2c-picks-campus">
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-violet-200">🎓 Campus picks</h3>
          <div className="space-y-2">
            {campusPicks.map((p) => (
              <PickRow key={p.id} p={p} />
            ))}
          </div>
        </section>
        <section data-testid="c2c-picks-canton">
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-blue-200">🏙 Canton picks</h3>
          <div className="space-y-2">
            {cantonPicks.map((p) => (
              <PickRow key={p.id} p={p} />
            ))}
          </div>
        </section>
      </div>
    )
  }

  return (
    <section data-testid="c2c-picks-combined">
      <h3 className="mb-2 text-[12px] font-bold uppercase text-white/80">Incoming player picks</h3>
      <div className="space-y-2">
        {(combined.length ? combined : picks).map((p) => (
          <PickRow key={p.id} p={p} />
        ))}
      </div>
    </section>
  )
}
