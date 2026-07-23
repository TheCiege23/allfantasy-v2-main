'use client'

import { isShadowLeague, sourcePlatformLabel } from '@/lib/league/write-authority'

export type ShadowLeagueBannerProps = {
  /** `League.platform`. Native/absent values render nothing. */
  platform: string | null | undefined
  className?: string
}

/**
 * Standing "this is a Shadow League" marker for the league shell.
 *
 * A Shadow League is a full digital twin of an imported league: rosters, lineups, trades,
 * waivers and settings are all editable, and Decision OS runs against them. What it is NOT is
 * a channel to the source platform — every change stops at AllFantasy's database.
 *
 * This banner states the operating mode once, at the top of the league, so the per-action
 * disclosures elsewhere (toasts, button labels) are reinforcement rather than the first time a
 * manager learns where their changes land. Renders nothing for NATIVE leagues, and — once a
 * provider write-back adapter ships and moves that platform to CONNECTED — nothing for those
 * either, with no edit to this file.
 */
export function ShadowLeagueBanner({ platform, className }: ShadowLeagueBannerProps) {
  if (!isShadowLeague(platform)) return null
  const source = sourcePlatformLabel(platform) ?? 'your host platform'

  return (
    <div
      data-testid="shadow-league-banner"
      className={[
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-sky-500/25 bg-sky-500/[0.08] px-3 py-2',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="rounded border border-sky-500/40 bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">
        Shadow League
      </span>
      <span className="text-[11px] text-sky-100/85">
        Imported from {source}. Edit lineups, trades and waivers freely — changes stay inside
        AllFantasy and never reach {source}, which remains your league&apos;s system of record.
      </span>
    </div>
  )
}
