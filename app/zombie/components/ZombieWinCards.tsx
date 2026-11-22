'use client'

type HordeWin = {
  role: string
  winnerName: string
  opponentName: string
  winnerScore: number | null
  opponentScore: number | null
  week: number | null
}

/** Text is always present; visual treatment only celebrates the settled result. */
export function ZombieWinCards({ cards }: { cards: HordeWin[] }) {
  if (!cards.length) return null
  return (
    <section aria-label="Horde wins" className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-red-100">Horde victories</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card, index) => {
          const whisperer = card.role === 'Whisperer'
          return (
            <article key={`${card.week}-${index}`}
              className={`relative min-w-0 overflow-hidden rounded-2xl border p-4 shadow-lg sm:p-5 ${whisperer ? 'border-violet-400/40 bg-gradient-to-br from-violet-950 via-slate-950 to-red-950' : 'border-red-400/40 bg-gradient-to-br from-red-950 via-slate-950 to-stone-950'}`}>
              <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-red-500/10 blur-2xl motion-safe:animate-pulse" />
              <p className="relative text-xs font-bold uppercase tracking-[0.2em] text-red-200">
                {whisperer ? '🎭 Whisperer victory' : '🧟 Zombie victory'} · Week {card.week ?? '—'}
              </p>
              <h3 className="relative mt-3 break-words text-xl font-black text-white">{card.winnerName} wins</h3>
              <p className="relative mt-1 break-words text-sm text-white/75">
                Against {card.opponentName}
                {card.winnerScore !== null && card.opponentScore !== null
                  ? ` · ${card.winnerScore.toFixed(1)}–${card.opponentScore.toFixed(1)}`
                  : ''}
              </p>
              <p className="relative mt-3 text-xs text-white/60">Final matchup result</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
