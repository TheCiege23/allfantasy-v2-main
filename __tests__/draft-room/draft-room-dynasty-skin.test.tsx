/**
 * Draft room dynasty identity: draft-kind chip ("Rookie draft · 2027" / "Startup draft"), the
 * dynasty skin on the top bar / shell / round-1 overlay, rookie-auction policy line, "Rookies
 * only" on by default for a rookie draft, round-1 announcement back for dynasty, and the honest
 * Taxi line in the roster strip. Redraft rooms must render exactly as before.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const value = () => {
    const t = (key: string) => dict[lang.language]?.[key] ?? dict.en[key] ?? key
    return { language: lang.language, setLanguage: () => {}, t, tInterpolate: (key: string) => t(key) }
  }
  return { useLanguage: value, useOptionalLanguage: value }
})
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img alt={String(props.alt ?? '')} src={String(props.src ?? '')} />,
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/app/draft-room/PlayerAvatar', () => ({ PlayerAvatar: () => null }))

import {
  formatDynastyDraftKindLabel,
  formatRookieAuctionPolicyNote,
  normalizeDraftSeasonYear,
  readRookieAuctionPolicyNote,
  resolveDynastyDraftKind,
  roomAnnouncesRoundOne,
  shouldDefaultRookiesOnly,
} from '@/lib/draft-room/dynastyDraftIdentity'
import { DraftTopBar, formatTimerSummary, resolveDraftFormatLabel } from '@/components/app/draft-room/DraftTopBar'
import { DraftRosterStrip } from '@/components/app/draft-room/DraftRosterStrip'

const en = (key: string) => translations.en[key] ?? key
const es = (key: string) => translations.es[key] ?? translations.en[key] ?? key
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

beforeEach(() => {
  lang.language = 'en'
})

describe('resolveDynastyDraftKind', () => {
  it('names a rookie draft from draftModeLabel', () => {
    expect(resolveDynastyDraftKind('rookie', true)).toBe('rookie')
    expect(resolveDynastyDraftKind('ROOKIE', true)).toBe('rookie')
  })
  it('a dynasty first draft (standard / startup / no label) is the startup', () => {
    for (const v of ['standard', 'startup', null, undefined, '']) expect(resolveDynastyDraftKind(v, true), String(v)).toBe('startup')
  })
  it('names supplemental and dispersal drafts', () => {
    expect(resolveDynastyDraftKind('supplemental', true)).toBe('supplemental')
    expect(resolveDynastyDraftKind('dispersal', true)).toBe('dispersal')
  })
  it('says nothing for a redraft league, an imported snapshot, or an unknown label', () => {
    for (const v of ['rookie', 'standard', null]) expect(resolveDynastyDraftKind(v, false)).toBeNull()
    expect(resolveDynastyDraftKind('imported_rosters', true)).toBeNull()
    expect(resolveDynastyDraftKind('something_new', true)).toBeNull()
  })
})

describe('formatDynastyDraftKindLabel', () => {
  it('rookie draft carries the class year when the season is known', () => {
    expect(formatDynastyDraftKindLabel('rookie', 2027, en)).toBe('Rookie draft · 2027')
    expect(formatDynastyDraftKindLabel('rookie', 2027, es)).toBe('Draft de novatos · 2027')
  })
  it('rookie draft drops the year rather than inventing one', () => {
    expect(formatDynastyDraftKindLabel('rookie', null, en)).toBe('Rookie draft')
  })
  it('startup has no year even when the season is known', () => {
    expect(formatDynastyDraftKindLabel('startup', 2026, en)).toBe('Startup draft')
    expect(formatDynastyDraftKindLabel('startup', 2026, es)).toBe('Draft inicial')
  })
  it('null kind is no label', () => {
    expect(formatDynastyDraftKindLabel(null, 2026, en)).toBeNull()
  })
})

describe('normalizeDraftSeasonYear', () => {
  it('accepts a real season as number or string', () => {
    expect(normalizeDraftSeasonYear(2027)).toBe(2027)
    expect(normalizeDraftSeasonYear('2026')).toBe(2026)
  })
  it('rejects junk instead of printing it', () => {
    for (const v of [0, null, undefined, '', 'abc', 26, 2026.5, NaN, {}]) expect(normalizeDraftSeasonYear(v), String(v)).toBeNull()
  })
})

describe('shouldDefaultRookiesOnly', () => {
  it('only a rookie draft opens on rookies', () => {
    expect(shouldDefaultRookiesOnly('rookie')).toBe(true)
    for (const v of ['standard', 'startup', 'supplemental', null]) expect(shouldDefaultRookiesOnly(v)).toBe(false)
  })
})

describe('rookie auction policy note', () => {
  const snap = (rookieAuction: unknown, over: Record<string, unknown> = {}) => ({
    draftModeLabel: 'rookie',
    draftType: 'auction',
    auction: { auctionState: { rookieAuction } },
    ...over,
  })
  const trade = { round: 1, originalRosterId: 'a', newRosterId: 'b' }

  it('reads the stored plan', () => {
    expect(readRookieAuctionPolicyNote(snap({ policy: 'budget', trades: [trade, trade] }))).toEqual({ policy: 'budget', tradeCount: 2 })
    expect(readRookieAuctionPolicyNote(snap({ policy: 'nominations', trades: [] }))).toEqual({ policy: 'nominations', tradeCount: 0 })
  })
  it('is null outside a rookie auction or with a malformed plan', () => {
    expect(readRookieAuctionPolicyNote(snap({ policy: 'budget', trades: [trade] }, { draftType: 'snake' }))).toBeNull()
    expect(readRookieAuctionPolicyNote(snap({ policy: 'budget', trades: [trade] }, { draftModeLabel: 'standard' }))).toBeNull()
    expect(readRookieAuctionPolicyNote(snap(null))).toBeNull()
    expect(readRookieAuctionPolicyNote(snap({ policy: 'swap' }))).toBeNull()
    expect(readRookieAuctionPolicyNote(null)).toBeNull()
  })
  it('explains only a conversion that happened', () => {
    expect(formatRookieAuctionPolicyNote({ policy: 'budget', tradeCount: 1 }, en)).toBe(
      'Rookie auction: 1 traded rookie pick became auction budget for its new owner.',
    )
    expect(formatRookieAuctionPolicyNote({ policy: 'nominations', tradeCount: 3 }, en)).toBe(
      'Rookie auction: 3 traded rookie picks became nomination turns for their new owners.',
    )
    expect(formatRookieAuctionPolicyNote({ policy: 'budget', tradeCount: 0 }, en)).toBeNull()
    expect(formatRookieAuctionPolicyNote({ policy: 'block', tradeCount: 0 }, en)).toBeNull()
    expect(formatRookieAuctionPolicyNote(null, en)).toBeNull()
  })
  it('Spanish never says waiver', () => {
    const line = formatRookieAuctionPolicyNote({ policy: 'nominations', tradeCount: 2 }, es)!
    expect(line).toContain('Subasta de novatos')
    expect(line.toLowerCase()).not.toContain('waiver')
  })
})

describe('roomAnnouncesRoundOne', () => {
  it('redraft snake still announces; redraft default still does not', () => {
    expect(roomAnnouncesRoundOne({ presentationVariant: 'redraft_snake', isDynasty: false, draftType: 'snake' })).toBe(true)
    expect(roomAnnouncesRoundOne({ presentationVariant: 'default', isDynasty: false, draftType: 'snake' })).toBe(false)
    expect(roomAnnouncesRoundOne({ presentationVariant: 'default', isDynasty: false, draftType: 'linear' })).toBe(false)
  })
  it('dynasty snake / linear rooms announce round 1 again', () => {
    expect(roomAnnouncesRoundOne({ presentationVariant: 'default', isDynasty: true, draftType: 'snake' })).toBe(true)
    expect(roomAnnouncesRoundOne({ presentationVariant: 'default', isDynasty: true, draftType: 'linear' })).toBe(true)
  })
  it('an auction has no pick order to announce', () => {
    expect(roomAnnouncesRoundOne({ presentationVariant: 'default', isDynasty: true, draftType: 'auction' })).toBe(false)
  })
})

describe('DraftTopBar strings keep their English and gain Spanish', () => {
  it('format and timer summary', () => {
    expect(resolveDraftFormatLabel('snake', true, en)).toBe('Snake + 3RR')
    expect(resolveDraftFormatLabel('linear', false, en)).toBe('Linear')
    expect(resolveDraftFormatLabel('auction', false, es)).toBe('Subasta')
    expect(formatTimerSummary(null, en)).toBe('Untimed picks')
    expect(formatTimerSummary(30, en)).toBe('30 Seconds Per Pick')
    expect(formatTimerSummary(60, en)).toBe('1 Minute Per Pick')
    expect(formatTimerSummary(90, en)).toBe('2 Minutes Per Pick')
    expect(formatTimerSummary(3600, en)).toBe('1 Hour Per Pick')
    expect(formatTimerSummary(2 * 86400, en)).toBe('2 Days Per Pick')
    expect(formatTimerSummary(2 * 86400, es)).toBe('2 días por selección')
  })
})

const baseBar = {
  leagueName: 'Gridiron Vault',
  sport: 'NFL',
  draftType: 'linear',
  teamCount: 12,
  rounds: 4,
  currentManagerOnClock: null,
  pickLabel: null,
  overallPickNumber: null,
  timerStatus: 'none' as const,
  timerRemainingSeconds: null,
  isCommissioner: false,
  draftStatus: 'pre_draft',
}

describe('DraftTopBar dynasty skin', () => {
  it('a dynasty room shows the draft-kind chip and the skin marker', () => {
    render(<DraftTopBar {...baseBar} dynastySkin dynastyDraftKindLabel="Rookie draft · 2027" />)
    expect(screen.getByTestId('draft-topbar-dynasty-kind').textContent).toBe('Rookie draft · 2027')
    // Phones get it on its own line so the league name keeps its width.
    expect(screen.getByTestId('draft-topbar-dynasty-kind-mobile').textContent).toBe('Rookie draft · 2027')
    expect(screen.getByTestId('draft-topbar-dynasty-kind-mobile').className).toContain('sm:hidden')
    expect(screen.getByTestId('draft-topbar-dynasty-kind').className).toContain('hidden')
    expect(document.querySelector('header')?.getAttribute('data-dynasty-skin')).toBe('true')
  })

  it('shows the rookie-auction line only when given one', () => {
    const { rerender } = render(<DraftTopBar {...baseBar} dynastySkin dynastyDraftKindLabel="Rookie draft" />)
    expect(screen.queryByTestId('draft-topbar-rookie-auction-note')).toBeNull()
    rerender(<DraftTopBar {...baseBar} dynastySkin dynastyDraftKindLabel="Rookie draft" rookieAuctionNote="Rookie auction: x" />)
    expect(screen.getByTestId('draft-topbar-rookie-auction-note').textContent).toBe('Rookie auction: x')
  })

  it('a redraft room gets no chip, no marker and its original header classes', () => {
    render(<DraftTopBar {...baseBar} dynastyDraftKindLabel="Startup draft" rookieAuctionNote="x" />)
    expect(screen.queryByTestId('draft-topbar-dynasty-kind')).toBeNull()
    expect(screen.queryByTestId('draft-topbar-rookie-auction-note')).toBeNull()
    const header = document.querySelector('header')!
    expect(header.getAttribute('data-dynasty-skin')).toBeNull()
    expect(header.getAttribute('style')).toBeNull()
    expect(header.className).toContain('from-[#070d1c]/95')
  })

  it('the dynasty skin never stacks on the redraft snake look', () => {
    render(<DraftTopBar {...baseBar} draftRoomPresentation="redraft_snake" dynastySkin dynastyDraftKindLabel="Startup draft" />)
    expect(screen.queryByTestId('draft-topbar-dynasty-kind')).toBeNull()
    expect(document.querySelector('header')?.getAttribute('data-dynasty-skin')).toBeNull()
  })

  it('renders the meta line in Spanish', () => {
    lang.language = 'es'
    render(<DraftTopBar {...baseBar} timerSeconds={120} />)
    const header = document.querySelector('header')!.textContent ?? ''
    expect(header).toContain('12 equipos')
    expect(header).toContain('4 rondas')
    expect(header).toContain('2 minutos por selección')
    expect(header).toContain('Lineal')
    expect(header).toContain('Invitar a la liga')
  })
})

describe('DraftRosterStrip Taxi section', () => {
  const picks = [{ playerName: 'Atlas Runner', position: 'RB', overall: 3 }]

  it('dynasty: an honest line instead of empty taxi slots', () => {
    render(<DraftRosterStrip picks={picks} isDynasty taxiSlots={null} />)
    const taxi = screen.getByTestId('draft-roster-strip-section-taxi')
    expect(taxi.textContent).toContain('Taxi moves happen on your roster after the draft.')
    expect(taxi.textContent).not.toContain('No taxi picks yet')
    expect(taxi.querySelectorAll('li')).toHaveLength(0)
  })

  it('names the league taxi capacity when roster config has it', () => {
    render(<DraftRosterStrip picks={picks} isDynasty taxiSlots={3} />)
    expect(screen.getByTestId('draft-roster-strip-empty-taxi').textContent).toBe(
      '3 taxi spots. Taxi moves happen on your roster after the draft.',
    )
  })

  it('Spanish', () => {
    lang.language = 'es'
    render(<DraftRosterStrip picks={picks} isDynasty taxiSlots={1} />)
    expect(screen.getByTestId('draft-roster-strip-empty-taxi').textContent).toBe(
      '1 puesto de taxi. Los movimientos al taxi se hacen en tu plantilla después del draft.',
    )
    expect(screen.getByTestId('draft-roster-strip').textContent).toContain('Titulares')
  })

  it('a pick actually tagged isTaxi still fills a taxi slot', () => {
    render(<DraftRosterStrip picks={[{ ...picks[0]!, isTaxi: true }]} isDynasty taxiSlots={2} />)
    const taxi = screen.getByTestId('draft-roster-strip-section-taxi')
    expect(taxi.querySelectorAll('li')).toHaveLength(2)
    expect(taxi.textContent).toContain('Atlas Runner')
  })

  it('redraft without taxi capacity has no Taxi section', () => {
    render(<DraftRosterStrip picks={picks} taxiSlots={0} />)
    expect(screen.queryByTestId('draft-roster-strip-section-taxi')).toBeNull()
  })
})

describe('wiring in the draft room', () => {
  const client = read('components/app/draft-room/DraftRoomPageClient.tsx')
  const page = read('app/drafts/[draftId]/page.tsx')

  it('dynasty stays out of the redraft_snake variant (its semantics are this-season only)', () => {
    expect(page).toMatch(/!context\.isDynasty &&\s*context\.routeType === 'snake'/)
    expect(client).toMatch(/presentationVariant === 'redraft_snake' && !isDynasty\s*\?\s*computeRedraftStarterHints/)
    expect(client).toMatch(/if \(presentationVariant !== 'redraft_snake' \|\| isDynasty\) return null/)
  })

  it('passes the skin, kind label, auction note and rookie default through', () => {
    expect(client).toMatch(/dynastySkin=\{isDynasty\}\s*dynastyDraftKindLabel=\{dynastyDraftKindLabel\}\s*rookieAuctionNote=\{rookieAuctionNote\}/)
    expect(client).toMatch(/defaultRookiesOnly=\{defaultRookiesOnly\}/)
    expect(client).toMatch(/const defaultRookiesOnly = isDynasty && shouldDefaultRookiesOnly\(session\?\.draftModeLabel\)/)
    expect(client).toMatch(/surfaceVariant=\{presentationVariant === 'redraft_snake' \? 'redraft_snake' : isDynasty \? 'dynasty' : 'default'\}/)
  })

  it('the round-1 queue and overlay share one gate', () => {
    expect(client.match(/roomAnnouncesRoundOne\(\{ presentationVariant, isDynasty, draftType: session\??\.draftType \}\)/g)).toHaveLength(2)
  })

  it('reads the season the settings route already returns', () => {
    expect(client).toMatch(/setLeagueSeasonYear\(settingsRes\.ok \? normalizeDraftSeasonYear\(settingsJson\?\.league\?\.season\) : null\)/)
  })
})

describe('PlayerPanel rookies-only default', () => {
  it('starts from the prop and applies a late true once', () => {
    const src = read('components/app/draft-room/PlayerPanel.tsx')
    expect(src).toMatch(/useState\(defaultRookiesOnly\)/)
    expect(src).toMatch(/if \(!defaultRookiesOnly \|\| appliedRookieDefaultRef\.current\) return/)
  })
})
