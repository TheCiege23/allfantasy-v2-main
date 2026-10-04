/**
 * Player Finder's recommended moves, its Chimmy verdict and the app-link hint, and the /core home's
 * freshness stamps, in Spanish (2026-10-04) — the cards #2043 left English rather than put Spanish
 * inside an English card.
 *
 * Every move here is `composePlayerMoves`'s REAL output, locked on every weekday through the real
 * `swapLegality`, so every lock reason is the English the screen receives; it is translated by the
 * SAME `coreUiCopy` lock patterns as every other /core lock label, its clock through `kickoffText`.
 * Every stamp is the real `freshnessStamp` / `leagueDataStamp` output, aged through every bucket
 * `relativeAge` has. And the English is pinned byte for byte where a reader keys on it.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import type { RecommendedMove } from '@/lib/core-app/playerFinder'
import { composePlayerMoves, type PlayerMove } from '@/lib/core-app/playerMoves'
import { moveText } from '@/lib/core-app/playerMovesCopy'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { kickoffClock } from '@/lib/core-app/lineupLock'
import { appLinkHint } from '@/lib/core-app/nativeApp'
import { freshnessStamp, leagueDataStamp, type CardFreshnessStamp } from '@/lib/core-app/cardFreshness'
import { RecommendedMoves } from '@/components/core-app/player-finder/RecommendedMoves'
import { PlayerVerdict } from '@/components/core-app/player-finder/PlayerVerdict'
import { AppLinkHint } from '@/components/core-app/player-finder/AppLinkHint'
import { CardFreshness } from '@/components/core-app/home/CardFreshness'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/

const text = (el: HTMLElement) => {
  // Visible text plus every title and aria-label — the reader hears those too.
  const attrs = [...el.querySelectorAll('[title],[aria-label]')].flatMap((n) => [n.getAttribute('title') ?? '', n.getAttribute('aria-label') ?? ''])
  return [el.textContent ?? '', ...attrs].join(' | ')
}

function expectSpanish(out: string, english: RegExp, label: string) {
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  expect(out, label).not.toMatch(english)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  lang.language = 'en'
})

/* ── Player Finder: the handoff's worked example (__tests__/player-finder-moves.test.ts) ─────────── */

function impact(over: Partial<LeagueImpact> & Pick<LeagueImpact, 'leagueId' | 'leagueName' | 'platform' | 'slot'>): LeagueImpact {
  return {
    platformLeagueId: null,
    season: 2026,
    exactSlot: null,
    slotConfirmed: true,
    isStarting: over.slot === 'STARTER',
    afPoints: { available: false, reason: 'unpriced in fixture' },
    replacements: { available: false, reason: 'none in fixture' },
    startOver: null,
    ...over,
  }
}

const DRAGONS = impact({
  leagueId: 'L-dragons',
  leagueName: 'Dynasty Dragons',
  platform: 'sleeper',
  platformLeagueId: '123456',
  slot: 'BENCH',
  afPoints: { available: true, data: { points: 11.1, matchedKeys: 4, scoredKeys: 30 } },
  startOver: { playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', slot: 'SUPER_FLEX', afPoints: 8.7, delta: 2.4, team: 'DAL' },
  slotConfirmed: false,
})
const ELITES = impact({
  leagueId: 'L-elites',
  leagueName: 'End Zone Elites',
  platform: 'espn',
  platformLeagueId: '777',
  slot: 'IR SLOT',
  afPoints: { available: true, data: { points: 10.6, matchedKeys: 4, scoredKeys: 28 } },
})
const WARRIORS = impact({
  leagueId: 'L-warriors',
  leagueName: 'Waiver Warriors',
  platform: 'yahoo',
  platformLeagueId: '55',
  slot: 'STARTER',
  exactSlot: 'TE',
  afPoints: { available: true, data: { points: 9.9, matchedKeys: 4, scoredKeys: 20 } },
})
const CLAIM: RecommendedMove = {
  leagueId: 'L-gang',
  leagueName: 'Gridiron Gang',
  platform: 'sleeper',
  projectionWeek: 12,
  affectedProjection: 6.2,
  freeAgents: [{ playerId: '9', name: 'Isaiah Likely', position: 'TE', team: 'BAL', projectedPoints: 12.3, delta: 6.1 }],
  claimTarget: { kind: 'provider', provider: 'sleeper', url: 'https://sleeper.com/leagues/999/players' },
}
const NATIVE_CLAIM: RecommendedMove = {
  ...CLAIM,
  leagueId: 'L-native',
  leagueName: 'Oficina FC',
  platform: 'allfantasy',
  freeAgents: [{ playerId: '10', name: 'Cade Otton', position: 'TE', team: 'TB', projectedPoints: 11, delta: 2.2 }],
  claimTarget: { kind: 'native', url: '/league/L-native/waivers' },
}

/** One Sunday-to-Saturday week of 1:00p ET kickoffs: Sun 10/25 … Sat 10/31. */
const DAYS = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 9, 25 + i, 17)).toISOString())
const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString()

/** The moves for every lock shape, on the kickoff's own weekday. */
function movesOn(day: string): PlayerMove[][] {
  const later = plus(day, 6 * 60)
  const base = { playerName: 'Dalton Kincaid', injuryStatus: 'Questionable', impact: [DRAGONS, ELITES, WARRIORS], freeAgents: [CLAIM, NATIVE_CLAIM], playerTeam: 'BUF' }
  return [
    // Before any kickoff: nothing locked.
    composePlayerMoves({ ...base, kickoffs: { BUF: day, DAL: day, BAL: day, TB: day }, nowIso: plus(day, -60) }),
    // Every game kicked off: "both games", "Kincaid’s game", "Likely’s game", "Otton’s game".
    composePlayerMoves({ ...base, kickoffs: { BUF: day, DAL: day, BAL: day, TB: day }, nowIso: plus(day, 30) }),
    // Only Ferguson's game: the swap names him.
    composePlayerMoves({ ...base, kickoffs: { BUF: later, DAL: day, BAL: later, TB: later }, nowIso: plus(day, 30) }),
  ]
}

const MOVES_EN = /\b(Swap|Move|Claim|out for|off IR|he's|active|locked|kicked off|both games|Open in|Lineup|Roster|Waivers|League|unrostered|week|standard scoring|scores nothing|slot unconfirmed|legal somewhere|under this league|Recommended moves|You make them|Nothing to do|priced|only reads|questionable)\b/

describe('Player Finder — the moves, from composePlayerMoves’ real output', () => {
  it('the English every reader keys on is unchanged, byte for byte', () => {
    const [before, locked, fergusonOnly] = movesOn(DAYS[0]!)
    expect(before.map((m) => [m.title, m.path, m.note, m.locked])).toEqual([
      ['Swap Ferguson out for Kincaid at SUPER FLEX', 'Sleeper › Dynasty Dragons › Lineup', 'slot unconfirmed — legal somewhere in this lineup', null],
      ["Move Kincaid off IR — he's questionable", 'ESPN › End Zone Elites › Roster', 'an IR-slot player scores nothing', null],
      ['Claim Isaiah Likely over Kincaid', 'Sleeper › Gridiron Gang › Waivers', 'TE · unrostered · week 12 · standard scoring', null],
      ['Claim Cade Otton over Kincaid', 'AllFantasy › Oficina FC › Waivers', 'TE · unrostered · week 12 · standard scoring', null],
    ])
    expect(locked.map((m) => m.locked)).toEqual([
      'locked — both games have kicked off',
      'locked — Kincaid’s game kicked off Sun 1:00p ET',
      'locked — Likely’s game kicked off Sun 1:00p ET',
      'locked — Otton’s game kicked off Sun 1:00p ET',
    ])
    expect(fergusonOnly.find((m) => m.key === 'start:L-dragons')?.locked).toBe('locked — Ferguson’s game kicked off Sun 1:00p ET')
    expect(before[0]!.link?.label).toBe('Open in Sleeper')
  })

  it('every title, path, note and lock reason reads Spanish, on every weekday', () => {
    for (const day of DAYS) {
      for (const moves of movesOn(day)) {
        for (const m of moves) {
          const t = moveText(m, 'es')
          const out = [t.title, t.path, t.note ?? ''].join(' | ')
          expectSpanish(out, MOVES_EN, `${day} ${m.key} ${out}`)
          if (m.locked) {
            const es = coreUiCopy(m.locked, 'es')
            expect(es, m.locked).not.toBe(m.locked)
            expect(t.note, m.locked).toContain(es)
            if (!/both games/.test(m.locked)) expect(es).toContain(kickoffText(kickoffClock(day), 'es'))
          }
        }
      }
    }
    const [before, locked] = movesOn(DAYS[3]!)
    expect(moveText(before[0]!, 'es')).toEqual({
      title: 'Sienta a Ferguson y alinea a Kincaid en SUPER FLEX',
      path: 'Sleeper › Dynasty Dragons › Alineación',
      note: 'puesto sin confirmar: válido en algún lugar de esta alineación',
    })
    expect(moveText(before[1]!, 'es').title).toBe('Saca a Kincaid del IR: está dudoso')
    expect(moveText(before[2]!, 'es')).toEqual({
      title: 'Reclama a Isaiah Likely en lugar de Kincaid',
      path: 'Sleeper › Gridiron Gang › Agentes libres',
      note: 'TE · sin equipo · semana 12 · puntuación estándar',
    })
    expect(moveText(locked[0]!, 'es').note).toBe('bloqueado: ya empezaron los dos partidos · puesto sin confirmar: válido en algún lugar de esta alineación')
    expect(moveText(locked[1]!, 'es').note).toBe('bloqueado: el partido de Kincaid empezó mié 1:00p ET · un jugador en el puesto de IR no anota puntos')
  })

  it('an active player off IR, and a move without parts stays whole English', () => {
    const [ir] = composePlayerMoves({ playerName: 'Dalton Kincaid', injuryStatus: 'Active', impact: [ELITES], freeAgents: [] })
    expect(ir!.title).toBe("Move Kincaid off IR — he's active")
    expect(moveText(ir!, 'es').title).toBe('Saca a Kincaid del IR: está activo')
    const { parts: _parts, ...bare } = ir!
    expect(moveText(bare, 'es')).toEqual({ title: ir!.title, path: ir!.path, note: ir!.note })
    expect(moveText(ir!, 'en')).toEqual({ title: ir!.title, path: ir!.path, note: ir!.note })
  })

  it('RecommendedMoves — every card, open and locked, on every weekday', () => {
    lang.language = 'es'
    for (const day of DAYS) {
      for (const moves of movesOn(day)) {
        const { container, unmount } = render(<RecommendedMoves moves={moves} emptyReason={null} />)
        const out = text(container)
        expectSpanish(out, MOVES_EN, day)
        expect(out).toContain('Movimientos recomendados')
        unmount()
      }
    }
    const { container } = render(<RecommendedMoves moves={movesOn(DAYS[0]!)[0]!} emptyReason={null} />)
    expect(container.textContent).toContain('Abrir en Sleeper')
    expect(container.textContent).toContain('Abrir en AllFantasy')
  })

  it('RecommendedMoves — every empty reason the screen passes', () => {
    lang.language = 'es'
    for (const reason of [
      null,
      'sign in to see which of your leagues this affects',
      'we hold no Sleeper id for this player, so we cannot locate him on your rosters',
      'we could not read your rosters for this player',
      'He is not on any of your rosters, so there is no lineup to fix.',
    ]) {
      const { container, unmount } = render(<RecommendedMoves moves={[]} emptyReason={reason} />)
      expectSpanish(text(container), /\b(sign in|we hold|could not|rosters|He is not|Nothing to do|Recommended|platform)\b/, String(reason))
      unmount()
    }
  })

  it('RecommendedMoves — English is unchanged', () => {
    const { container } = render(<RecommendedMoves moves={movesOn(DAYS[0]!)[1]!} emptyReason={null} />)
    const out = text(container)
    expect(out).toContain('Recommended moves')
    expect(out).toContain('Swap Ferguson out for Kincaid at SUPER FLEX')
    expect(out).toContain('Sleeper › Dynasty Dragons › Lineup · locked — both games have kicked off · slot unconfirmed — legal somewhere in this lineup')
    expect(container.querySelector('.af-pf-move-locked')?.getAttribute('title')).toBe('locked — both games have kicked off')
  })

  it('PlayerVerdict — every headline, all leagues and one league', () => {
    lang.language = 'es'
    const VERDICT_EN = /\b(He is|He starts|misplaced|fix|fixes|bench|right call|worth|in your lineup|league|leagues|Verdict|Ask Chimmy|read-only|Every change|which screen|BENCH|STARTER|SLOT|or)\b/
    const cases: Array<{ impact: LeagueImpact[]; scope: 'all' | 'league'; moves: PlayerMove[] }> = []
    for (const scope of ['all', 'league'] as const) {
      const all = [DRAGONS, ELITES, WARRIORS]
      cases.push({ impact: all, scope, moves: movesOn(DAYS[2]!)[0]! }) // fixes
      cases.push({ impact: [WARRIORS], scope, moves: [] }) // starts everywhere
      cases.push({ impact: [WARRIORS, { ...DRAGONS, startOver: { ...DRAGONS.startOver!, delta: -1 } }], scope, moves: [] }) // bench is right
      cases.push({ impact: [{ ...DRAGONS, startOver: null }], scope, moves: [] }) // benched, priced
      cases.push({ impact: [{ ...DRAGONS, startOver: null, afPoints: { available: false, reason: 'x' } }], scope, moves: [] }) // benched, unpriced
    }
    for (const c of cases) {
      const { container, unmount } = render(<PlayerVerdict playerName="Dalton Kincaid" impact={c.impact} moves={c.moves} scope={c.scope} />)
      const out = text(container)
      expectSpanish(out, VERDICT_EN, `${c.scope} ${out}`)
      const href = decodeURIComponent(container.querySelector('.af-pf-verdict-cta')?.getAttribute('href') ?? '')
      expect(href).toContain('¿Qué debería hacer con Dalton Kincaid esta semana?')
      unmount()
    }
    const { container } = render(<PlayerVerdict playerName="Dalton Kincaid" impact={[DRAGONS]} moves={movesOn(DAYS[0]!)[0]!.slice(0, 1)} scope="league" />)
    expect(container.querySelector('.af-pf-verdict-headline')?.textContent).toBe(
      'Sienta a Ferguson y alinea a Kincaid en SUPER FLEX: +2.4 con la puntuación de esta liga.',
    )
  })

  it('PlayerVerdict — English is unchanged', () => {
    const { container } = render(<PlayerVerdict playerName="Dalton Kincaid" impact={[DRAGONS, ELITES, WARRIORS]} moves={movesOn(DAYS[0]!)[0]!} />)
    expect(container.querySelector('.af-pf-verdict-headline')?.textContent).toBe('He is misplaced in 2 of 3 leagues. 2 fixes for +13.0.')
    expect(container.querySelector('.af-pf-verdict-cta')?.textContent).toBe('Ask Chimmy about Kincaid')
    expect(text(container)).toContain('BENCH')
  })
})

describe('Player Finder — AppLinkHint, every platform, screen and phone', () => {
  const UA = {
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
  }
  it('reads Spanish wherever it says anything', () => {
    lang.language = 'es'
    let said = 0
    for (const [os, ua] of Object.entries(UA)) {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
      for (const platform of ['Sleeper', 'ESPN', 'Yahoo']) {
        for (const screen of ['Lineup', 'Waivers', 'Trade', 'League']) {
          const { container, unmount } = render(<AppLinkHint platform={platform} screen={screen} />)
          const out = container.textContent ?? ''
          expect(out, `${os} ${platform} ${screen}`).not.toMatch(/\b(Opens|open|app when|installed|on the web|does not take|May)\b/)
          if (out) said++
          unmount()
        }
      }
      vi.restoreAllMocks()
    }
    expect(said).toBe(24)
    expect(appLinkHint('sleeper', 'Lineup', 'ios', 'es')).toBe('Abre Sleeper en la web: su app no acepta enlaces de ligas en iPhone')
    expect(appLinkHint('espn', 'Waivers', 'ios', 'es')).toBe('Se abre en la app de ESPN si la tienes instalada')
    expect(appLinkHint('yahoo', 'Lineup', 'android', 'es')).toBe('Puede abrirse en la app de Yahoo')
  })

  it('English is unchanged, with or without a language', () => {
    expect(appLinkHint('yahoo', 'Lineup', 'ios', 'en')).toBe('Opens in the Yahoo app when it’s installed')
    expect(appLinkHint('sleeper', 'Lineup', 'ios')).toBe('Opens Sleeper on the web — its app does not take league links on iPhone')
  })
})

/* ── The home's freshness stamps ───────────────────────────────────────────────────────────────── */

describe('Home — CardFreshness, from freshnessStamp / leagueDataStamp’s real output', () => {
  const NOW = new Date('2026-10-04T12:00:00Z')
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
  /** One instant per `relativeAge` bucket: just now, min, h, d, w, mo, y. */
  const AGES = [20_000, 7 * 60_000, 3 * 3_600_000, 2 * 86_400_000, 14 * 86_400_000, 60 * 86_400_000, 400 * 86_400_000]

  const stampsAt = (at: string | null): CardFreshnessStamp[] => [
    freshnessStamp('Injury feed checked', at, NOW, { staleRule: 'injuries', parts: { kind: 'injuries' } }),
    freshnessStamp('Scores', at, NOW, { missing: 'none-yet', parts: { kind: 'scores' } }),
    freshnessStamp('Summary', at, NOW, { parts: { kind: 'summary' } }),
    leagueDataStamp({ oldestAt: at, neverSynced: 0, syncable: 1 }, NOW),
    leagueDataStamp({ oldestAt: at, neverSynced: 1, syncable: 3 }, NOW),
    leagueDataStamp({ oldestAt: at, neverSynced: 2, syncable: 4, paused: 1 }, NOW),
    leagueDataStamp({ oldestAt: at, neverSynced: 0, syncable: 2, paused: 3 }, NOW),
  ]
  const STAMP_EN = /\b(updated|checked|Injury|feed|Scores|Summary|league|leagues|data|Oldest|active|never|read|paused|connections?|excluded|Account|sync|history|retained|none|yet|ago|just now|out of date)\b/i

  function renderAt(stamps: CardFreshnessStamp[]) {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const r = render(<CardFreshness stamps={stamps} />)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    return r
  }

  it('every source, every age bucket, and every missing time', () => {
    lang.language = 'es'
    for (const ms of AGES) {
      const { container, unmount } = renderAt(stampsAt(ago(ms)))
      const out = container.textContent ?? ''
      expectSpanish(out, STAMP_EN, `${ms} ${out}`)
      expect(out).toMatch(/justo ahora|hace \d+/)
      unmount()
    }
    const missing = [
      ...stampsAt(null),
      leagueDataStamp({ oldestAt: null, neverSynced: 0, syncable: 0 }, NOW),
      leagueDataStamp({ oldestAt: null, neverSynced: 0, syncable: 0, paused: 2 }, NOW),
    ]
    const { container } = renderAt(missing)
    expectSpanish(container.textContent ?? '', STAMP_EN, 'missing')
  })

  it('says the right Spanish, and puts the excluded connections after the age', () => {
    lang.language = 'es'
    const { container } = renderAt([
      leagueDataStamp({ oldestAt: ago(3 * 3_600_000), neverSynced: 1, syncable: 3, paused: 2 }, NOW),
      freshnessStamp('Injury feed checked', ago(7 * 60_000), NOW, { staleRule: 'injuries', parts: { kind: 'injuries' } }),
    ])
    expect(container.textContent).toBe(
      '⚠ 1 liga nunca leída · Datos de ligas activas más antiguos actualizados hace 3 h · 2 conexiones en pausa excluidas (desactualizado)' +
        ' · Parte de lesiones revisado hace 7 min',
    )
  })

  it('a stamp without parts stays whole English', () => {
    lang.language = 'es'
    const { container } = renderAt([freshnessStamp('Rosters', ago(7 * 60_000), NOW)])
    expect(container.textContent).toBe('Rosters updated 7 min ago')
  })

  it('English is unchanged, byte for byte', () => {
    const stamp = leagueDataStamp({ oldestAt: ago(3 * 3_600_000), neverSynced: 1, syncable: 3, paused: 2 }, NOW)
    expect(stamp.source).toBe('1 league never read · Oldest active league data · 2 paused connections excluded')
    expect(leagueDataStamp({ oldestAt: null, neverSynced: 0, syncable: 0, paused: 1 }, NOW)).toMatchObject({
      source: 'Account sync paused',
      missingLabel: 'history retained',
    })
    const { container } = renderAt([stamp, freshnessStamp('Scores', null, NOW, { missing: 'none-yet', parts: { kind: 'scores' } })])
    expect(container.textContent).toBe(
      '⚠ 1 league never read · Oldest active league data · 2 paused connections excluded updated 3h ago (out of date) · Scores none yet',
    )
  })
})
