import Link from 'next/link'
import { History } from 'lucide-react'
import { resolveBracketChallengeLabel, resolveBracketSportUI } from '@/lib/bracket-challenge'

type HistoryPool = {
  id: string
  name: string
  entries: number
  sport: string
  challengeType?: string | null
  bracketType?: string | null
}

export default function BracketHistoryTab({ pools }: { pools: HistoryPool[] }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-white/15 bg-black/30 p-2">
          <History className="h-4 w-4 text-cyan-300" />
        </div>
        <Link href="/brackets" className="text-xs text-cyan-300 hover:underline">Full history</Link>
      </div>
      <h3 className="text-sm font-semibold text-white">History</h3>
      {pools.length === 0 ? (
        <p className="mt-1 text-xs text-white/60">No completed pools yet. Your history appears once results lock in.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-xs text-white/80">
          {pools.slice(0, 3).map((p) => {
            const sportUI = resolveBracketSportUI(p.sport)
            const challengeLabel = resolveBracketChallengeLabel({
              sport: p.sport,
              challengeType: p.challengeType,
              bracketType: p.bracketType,
            })
            return (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
                <span className="truncate pr-2">
                  <span className="block truncate">{p.name}</span>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-white/50">
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-200/85">
                      <span className="font-semibold">{sportUI.badge}</span>
                      <span>{sportUI.shortLabel}</span>
                    </span>
                    <span>{challengeLabel}</span>
                  </span>
                </span>
                <span className="text-white/50">{p.entries} entries</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
