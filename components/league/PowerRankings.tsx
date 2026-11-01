import type { LeaguePowerRankingItem } from '@/components/league/types'

export default function PowerRankings({
  items,
}: {
  items: LeaguePowerRankingItem[]
}) {
  if (!items.length) return null

  return (
    <section className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4">
      <div className="mb-3 text-[18px] font-semibold text-white">Power Rankings</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-xl bg-[#0E1424] px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-white">
                #{item.rank} {item.name}
              </div>
              <div className="mt-1 text-xs text-white/60">{item.record}</div>
            </div>
            <div className="text-sm font-semibold text-[var(--badge-text-cyan)]">{item.pointsFor}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
