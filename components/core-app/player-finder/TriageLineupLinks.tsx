'use client'

import { useEffect, useState } from 'react'

import type { TriageLeague } from '@/lib/core-app/gameDayTriage'
import { lineupLink, platformLabel } from '@/lib/core-app/platformLinks'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * One "open lineup" button per league a flagged starter starts in, on the game-day
 * list itself — so twenty leagues are twenty taps, not twenty round trips through
 * the player card.
 *
 * ⚠ A CHECKLIST, NOT A CLAIM THAT ANYTHING WAS FIXED. Tapping a button marks that
 * league "opened" on this device for this week; AllFantasy cannot see the change
 * you then make on Sleeper or ESPN, so the mark says what you did here and nothing
 * more. The row itself stays flagged until the roster read says otherwise.
 *
 * ⚠ localStorage IS A CONVENIENCE HERE. It can be empty or throw (private mode,
 * blocked site data); every read and write is guarded and the buttons work the same
 * without it.
 */

const STORAGE_PREFIX = 'af:pf:triage-opened:v1:'

function readOpened(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function writeOpened(key: string, opened: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify([...opened]))
  } catch {
    /* storage unavailable — the mark lives for this page view only */
  }
}

export function TriageLineupLinks({
  playerKey,
  playerName,
  leagues,
  weekKey,
  locked,
}: {
  /** Stable per player (his Sleeper id) — half of each checklist entry. */
  playerKey: string
  playerName: string
  leagues: TriageLeague[]
  /** "2026-3" — the checklist resets every week. */
  weekKey: string
  /** His game has kicked off: nothing can move, so no buttons. */
  locked: boolean
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setOpened(readOpened(weekKey))
  }, [weekKey])

  if (leagues.length === 0) return null

  if (locked) {
    return (
      <p className="af-pf-triage-leagues af-pf-triage-leagues--locked">
        {leagues.map((l) => `${l.leagueName} · ${platformLabel(l.platform)}`).join(', ')}
      </p>
    )
  }

  const mark = (leagueId: string) => {
    const next = new Set(readOpened(weekKey))
    next.add(`${playerKey}:${leagueId}`)
    writeOpened(weekKey, next)
    setOpened(next)
  }

  return (
    <ul className="af-pf-triage-leagues" aria-label={es ? `Abrir las alineaciones de ${playerName}` : `Open ${playerName}'s lineups`}>
      {leagues.map((l) => {
        const link = lineupLink({
          id: l.leagueId,
          platform: l.platform,
          platformLeagueId: l.platformLeagueId ?? null,
          season: l.season ?? null,
          name: l.leagueName,
          teamId: l.teamId ?? null,
        })
        const done = opened.has(`${playerKey}:${l.leagueId}`)
        const platform = platformLabel(l.platform)
        if (!link) {
          return (
            <li key={l.leagueId} className="af-pf-triage-lg" data-link="none">
              <span className="af-pf-triage-lg-name">{l.leagueName}</span>
              <span className="af-pf-triage-lg-where">{platform}</span>
            </li>
          )
        }
        // "League" or "<Provider> home" means the lineup screen itself could not be built — say where it lands.
        const lands = link.screen === 'Lineup' ? 'lineup' : link.screen.toLowerCase()
        const home = link.screen.match(/^(.+) home$/)
        const landsEs =
          link.screen === 'Lineup' ? 'la alineación' : home ? `inicio de ${home[1]}` : coreUiCopy(link.screen, 'es').toLowerCase()
        return (
          <li key={l.leagueId} className="af-pf-triage-lg" data-opened={done ? 'true' : undefined}>
            <a
              className="af-pf-triage-lg-btn"
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              onClick={() => mark(l.leagueId)}
              aria-label={
                es
                  ? `${done ? 'Abierta: ' : ''}${l.leagueName}: abrir ${landsEs} en ${link.platformLabel}`
                  : `${done ? 'Opened: ' : ''}${l.leagueName} — open the ${lands} on ${link.platformLabel}`
              }
            >
              <span className="af-pf-triage-lg-check" aria-hidden>
                {done ? '✓' : ''}
              </span>
              <span className="af-pf-triage-lg-name">{l.leagueName}</span>
              <span className="af-pf-triage-lg-where">
                {platform}
                {lands === 'lineup' ? '' : ` · ${es ? landsEs : lands}`}
                {link.external ? ' ↗' : ''}
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export default TriageLineupLinks
