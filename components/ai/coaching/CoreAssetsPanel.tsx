'use client'

import type { CoachingPlanResponse } from '@/lib/ai/coaching/coachingPlanTypes'
import { cn } from '@/lib/utils'

const TAG: Record<
  NonNullable<CoachingPlanResponse['coreAssets']>[number]['tag'],
  string
> = {
  core: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-100',
  sell_high: 'border-amber-500/35 bg-amber-500/10 text-amber-100',
  trade_block: 'border-violet-500/35 bg-violet-500/10 text-violet-100',
  hold: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100',
  devy_stash: 'border-fuchsia-500/35 bg-fuchsia-500/10 text-fuchsia-100',
}

function tagLabel(t: keyof typeof TAG): string {
  return t.replace(/_/g, ' ')
}

function headshotUrl(
  asset: NonNullable<CoachingPlanResponse['coreAssets']>[number],
  sport: string,
): string | null {
  if (asset.imageUrl) return asset.imageUrl
  if (sport === 'NFL' || sport === 'nfl') {
    return `https://sleepercdn.com/content/nfl/players/thumb/${asset.playerId}.jpg`
  }
  return null
}

export function CoreAssetsPanel({
  assets,
  sport,
}: {
  assets: NonNullable<CoachingPlanResponse['coreAssets']>
  sport: string
}) {
  if (!assets.length) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#070d18] p-5 text-[13px] text-white/50">
        Player tagging will appear after roster signals resolve.
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#070d18] p-5 md:p-6">
      <h2 className="text-sm font-bold text-white">Player core & building blocks</h2>
      <p className="mt-1 text-[11px] text-white/45">Cornerstones, sells, and holds</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((a) => {
          const src = headshotUrl(a, sport)
          return (
            <div
              key={`${a.playerId}-${a.tag}`}
              className="flex gap-3 rounded-xl border border-white/[0.06] bg-black/30 p-3"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0d1526]">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Sleeper CDN
                  <img src={src} alt="" className="h-full w-full object-cover" onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white/40">
                    {a.position}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-[13px] font-semibold text-white">{a.name}</p>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                      TAG[a.tag],
                    )}
                  >
                    {tagLabel(a.tag)}
                  </span>
                </div>
                <p className="text-[11px] text-white/45">
                  {a.position}
                  {a.team ? ` · ${a.team}` : ''}
                  {a.age != null ? ` · age ${a.age}` : ''}
                </p>
                {a.note ? <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-white/60">{a.note}</p> : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
