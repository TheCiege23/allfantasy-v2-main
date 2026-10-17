'use client'

import Link from 'next/link'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { ageText } from '@/lib/core-app/shellCopy'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { realManagerName, rosterLabel } from '@/lib/core-app/managerName'

/**
 * The words of DashScheduleBand, in the reader's language (2026-10-04).
 *
 * The band is a SERVER component and the language is client state, so the band decides WHAT to say —
 * which matchups, whether the kickoff is still ahead, which week — and this says it. The kickoff
 * arrives as `kickoffDayLabel`'s pinned English ("Oct 4") and goes through `kickoffText` here; the
 * provider starts at English on server and client alike, so the first paint agrees.
 *
 * ⚠ ONLY SLICES CROSS THE BOUNDARY. Each card gets the five fields it shows, never the WeekBoard
 * (its projections and model text would be serialized into the page for nothing).
 */
export type ScheduleBandCard = {
  key: string
  href: string
  leagueName: string
  opponent: { name: string | null; rosterId: string | number | null }
  elimination: boolean
  platform: string
}

export type ScheduleBandViewProps = {
  /** The week to name, or null for the neutral "This week" (see the band on why). */
  week: number | null
  /** `kickoffDayLabel` output ("Oct 4") for a kickoff still ahead; null otherwise. */
  kickoff: string | null
  total: number
  visible: ScheduleBandCard[]
  overflow: number
  withoutSchedule: number
  /** "4m ago" when fresh; null when stale or unknown — never guessed. */
  syncLabel: string | null
}

/** Never invent a manager. An unnamed roster says which roster it is. */
function opponentLabel(o: ScheduleBandCard['opponent'], es: boolean): string {
  if (!es) return rosterLabel([o.name], o.rosterId)
  const real = realManagerName(o.name)
  if (real) return real
  const id = String(o.rosterId ?? '').trim()
  return id ? `Equipo ${id}` : 'Rival'
}

/** "4m ago" (the page passes describeAge's label) or "synced 4m ago" — the age through shellCopy's `ageText`. */
function syncText(label: string, language: string): string {
  const m = label.match(/^synced (.+)$/)
  return m ? (language === 'es' ? `sincronizado ${ageText(m[1]!, language)}` : label) : ageText(label, language)
}

export function DashScheduleBandView({ week, kickoff, total, visible, overflow, withoutSchedule, syncLabel }: ScheduleBandViewProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const weekLabel = week != null ? (es ? `Semana ${week}` : `Week ${week}`) : es ? 'Esta semana' : 'This week'

  return (
    <section className="af-core af-sched" aria-label={es ? 'Contra quién juegas esta semana' : 'Who you play this week'}>
      <div className="af-sched-head">
        <span className="af-label af-sched-kicker">
          {weekLabel} · {es ? 'contra quién juegas' : 'who you play'}
        </span>
        {/* One "?" for the ELIM chip, at the heading — the cards are links, and a tip may not sit in one. */}
        {visible.some((m) => m.elimination) ? <TopicTip topic="eliminationFormat" /> : null}
        <span className="af-sched-when af-num">
          {[
            es
              ? total === 1
                ? '1 enfrentamiento'
                : `${total} enfrentamientos`
              : total === 1
                ? '1 matchup'
                : `${total} matchups`,
            /* "next", not "first": only a FUTURE kickoff is shown, and on a Monday that is the
               Monday-night game, not the week's first (it read "first kickoff Sep 28" for week 3). */
            kickoff ? (es ? `próximo inicio ${kickoffText(kickoff, 'es')}` : `next kickoff ${kickoff}`) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      <div className="af-sched-grid">
        {visible.map((m) => (
          <Link key={m.key} className="af-sched-card" href={m.href}>
            <span className="af-sched-league">{m.leagueName}</span>
            <span className="af-sched-vs">
              vs <b>{opponentLabel(m.opponent, es)}</b>
            </span>
            <span className="af-sched-plat af-num">
              {/*
                Guillotine and survivor leagues eliminate the lowest score each
                week — an existential stake a head-to-head card does not carry,
                and the one thing about this matchup that changes how you play
                it. The chip states the format; the chop-line distance needs
                scoring that does not exist yet, so it is not implied here.
              */}
              {m.elimination ? <span className="af-sched-elim">ELIM</span> : null}
              {m.platform.toUpperCase()}
            </span>
          </Link>
        ))}
      </div>

      <p className="af-sched-foot af-num">
        {[
          overflow > 0 ? (es ? `+${overflow} más` : `+${overflow} more`) : null,
          /*
           * Leagues whose schedule we hold nothing for — stated, not hidden,
           * so "6 matchups" on a 61-league account reads as coverage rather
           * than as a claim that the other 55 have no games.
           */
          withoutSchedule > 0
            ? es
              ? withoutSchedule === 1
                ? 'aún sin calendario para tu otra liga'
                : `aún sin calendario para tus otras ${withoutSchedule} ligas`
              : `no schedule yet for your other ${withoutSchedule} ${withoutSchedule === 1 ? 'league' : 'leagues'}`
            : null,
          syncLabel ? syncText(syncLabel, language) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        {overflow > 0 || withoutSchedule > 0 ? (
          <>
            {' '}
            <Link className="af-sched-all" href="/core/week">
              {es ? 'Abrir tu semana' : 'Open your week'}
            </Link>
          </>
        ) : null}
      </p>
    </section>
  )
}

export default DashScheduleBandView
