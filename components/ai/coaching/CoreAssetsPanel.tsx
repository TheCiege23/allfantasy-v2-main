'use client'

import type { CoachingPlanResponse } from '@/lib/ai/coaching/coachingPlanTypes'
import { cn } from '@/lib/utils'

const TAG: Record<
  NonNullable<CoachingPlanResponse['coreAssets']>[number]['tag'],
  string
> = {
  core: 'rdt-accent-line rdt-accent-soft rdt-accent',
  sell_high: 'rdt-warn-line rdt-warn-soft rdt-warn',
  trade_block: 'rdt-accent-line rdt-accent-soft rdt-accent',
  hold: 'rdt-good-line rdt-good-soft rdt-good',
  devy_stash: 'rdt-accent-line rdt-accent-soft rdt-accent',
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
      <section className="rounded-2xl border rdt-line rdt-surface p-5 text-[13px] rdt-faint">
        Player tagging will appear after roster signals resolve.
      </section>
    )
  }

  return (
    <section className="rounded-2xl border rdt-line rdt-surface p-5 md:p-6">
      <h2 className="text-sm font-bold rdt-text">Player core & building blocks</h2>
      <p className="mt-1 text-[11px] rdt-faint">Cornerstones, sells, and holds</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((a) => {
          const src = headshotUrl(a, sport)
          return (
            <div
              key={`${a.playerId}-${a.tag}`}
              className="flex gap-3 rounded-xl border rdt-line rdt-well p-3"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border rdt-line2 rdt-surface">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Sleeper CDN
                  <img src={src} alt="" className="h-full w-full object-cover" onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] font-bold rdt-faint">
                    {a.position}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-[13px] font-semibold rdt-text">{a.name}</p>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                      TAG[a.tag],
                    )}
                  >
                    {tagLabel(a.tag)}
                  </span>
                </div>
                <p className="text-[11px] rdt-faint">
                  {a.position}
                  {a.team ? ` · ${a.team}` : ''}
                  {a.age != null ? ` · age ${a.age}` : ''}
                </p>
                {a.note ? <p className="mt-1 line-clamp-3 text-[11px] leading-snug rdt-muted">{a.note}</p> : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
