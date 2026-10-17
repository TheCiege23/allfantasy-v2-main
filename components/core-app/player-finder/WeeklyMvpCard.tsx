'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { PlayerAvatar } from '@/components/core-app/player-finder/PlayerMarks'
import type { WeeklyMvp } from '@/lib/core-app/weeklyMvp'
import { playerFunCopy } from '@/lib/core-app/playerFunCopy'

/**
 * "Your Week N MVP" on the "My players" home (Guap, 2026-10-08, item #5): the player who scored the
 * most for you last week across your leagues (weeklyMvp.ts), as a card worth showing off — with a
 * Share button that uses the phone's own share sheet, or copies the line where there is none.
 *
 * ⚠ THE SHARED TEXT NAMES THE PLAYER, THE WEEK AND THE POINTS — NEVER A LEAGUE. League names are the
 * user's private context (and other managers'); a brag line does not need them.
 */

function headshot(m: WeeklyMvp): string | null {
  return m.player.imageUrl ?? `https://sleepercdn.com/content/nfl/players/thumb/${m.player.sleeperId}.jpg`
}

export function WeeklyMvpCard({ mvp }: { mvp: WeeklyMvp | null }) {
  const { language } = useOptionalLanguage()
  const [shared, setShared] = useState<'shared' | 'copied' | null>(null)
  if (!mvp) return null
  const t = playerFunCopy(language)
  const pts = mvp.points.toFixed(1)
  const n = mvp.leagues.length
  const text = t.mvpShareText(mvp.week, mvp.player.name, pts, n)
  const href = mvp.player.ref ? `/core/players?q=${encodeURIComponent(mvp.player.name)}&player=${encodeURIComponent(mvp.player.ref)}` : null

  const share = async () => {
    const nav = typeof navigator !== 'undefined' ? navigator : null
    try {
      if (nav && typeof nav.share === 'function') {
        await nav.share({ text })
        setShared('shared')
        return
      }
      if (nav?.clipboard) {
        await nav.clipboard.writeText(text)
        setShared('copied')
      }
    } catch {
      // A dismissed share sheet throws AbortError — nothing to report.
    }
  }

  const name = href ? (
    <Link href={href} className="af-pf-mvp-name">
      {mvp.player.name}
    </Link>
  ) : (
    <span className="af-pf-mvp-name">{mvp.player.name}</span>
  )

  return (
    <section className="af-card af-pf-mvp" aria-labelledby="af-pf-mvp-h">
      <div className="af-pf-mvp-art" aria-hidden>
        🏆
      </div>
      <div className="af-pf-mvp-body">
        <h3 className="af-label af-pf-mvp-kicker" id="af-pf-mvp-h">
          {t.mvpKicker(mvp.week)}
        </h3>
        <div className="af-pf-mvp-who">
          <PlayerAvatar src={headshot(mvp)} name={mvp.player.name} size={48} />
          <span className="af-pf-mvp-text">
            {name}
            <span className="af-pf-mvp-meta af-num">
              {[mvp.player.position, mvp.player.team].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
        <p className="af-pf-mvp-points af-num">{t.mvpPoints(pts, n)}</p>
        {mvp.runnerUp ? <p className="af-pf-mvp-beat af-num">{t.mvpBeat(mvp.runnerUp.name, (mvp.points - mvp.runnerUp.points).toFixed(1))}</p> : null}
        <ul className="af-pf-mvp-leagues">
          {mvp.leagues.slice(0, 4).map((l) => (
            <li key={l.leagueId} className="af-chip af-num">
              {l.leagueName} · {l.points.toFixed(1)}
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="af-btn af-pf-mvp-share" onClick={share}>
        {shared === 'copied' ? t.mvpCopied : shared === 'shared' ? t.mvpShared : t.mvpShare}
      </button>
    </section>
  )
}

export default WeeklyMvpCard
