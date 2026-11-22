/**
 * Post-create welcome (2026-10-13): one intro, then the "your league is ready" sheet with the
 * invite (QR, share sheet, text, WhatsApp, copy), with the handoff flags cleared after one read.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
  useOptionalLanguage: () => ({ t: (key: string) => key, tInterpolate: (key: string) => key }),
}))

import {
  chooseWelcomeIntro,
  firstEntryIntroKinds,
  firstEntryIntroStorageKey,
  markFirstEntryIntrosSeen,
  shouldStartPostCreateWelcome,
  stripPostCreateHandoff,
} from '@/lib/league/post-create-welcome'
import {
  countClaimedSeats,
  inviteShareMessage,
  leagueJoinUrl,
  nativeLeagueInviteCode,
  smsInviteHref,
  whatsAppInviteHref,
} from '@/lib/league/league-invite-link'
import { buildPostCreateLeagueHomeHref } from '@/lib/league/post-create-navigation'
import { LeagueInviteShare, copyInviteText } from '@/components/league/invite/LeagueInviteShare'
import { PostCreateWelcomeSheet, formatWelcomeDraftDate, type PostCreateWelcomeLeague } from '@/components/league/post-create/PostCreateWelcomeSheet'
import { LeagueConceptIntroGate } from '@/components/league/LeagueConceptIntroGate'
import { ConceptIntroVideoOverlay } from '@/components/league/ConceptIntroVideoOverlay'
import { SurvivorFirstEntryModal } from '@/components/survivor/SurvivorFirstEntryModal'
import { GuillotineFirstEntryModal } from '@/components/guillotine/GuillotineFirstEntryModal'

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the post-create handoff flags are read once, then cleared', () => {
  it('strips exactly the flags create adds, and keeps everything else', () => {
    const href = buildPostCreateLeagueHomeHref({ leagueId: 'L1', leagueType: 'survivor', allowInviteLink: true, zombieUniverseTier: 'beta_trio' })
    const search = href.split('?')[1]
    expect(search).toContain('created=1')
    expect(stripPostCreateHandoff(`?${search}&view=native_home`)).toBe('zombieTier=beta_trio&view=native_home')
  })

  it('leaves a normal ?openChat=league deep link alone — only a real handoff is stripped', () => {
    expect(stripPostCreateHandoff('?openChat=league')).toBeNull()
    expect(stripPostCreateHandoff('?view=draft')).toBeNull()
    expect(stripPostCreateHandoff('')).toBeNull()
  })

  it('starts only for the commissioner who just created, outside embed mode', () => {
    const base = { createdFromLeagueCreate: true, isCommissioner: true, defaultShowInvite: true, shouldPlayIntro: true, embedMode: false }
    expect(shouldStartPostCreateWelcome(base)).toBe(true)
    expect(shouldStartPostCreateWelcome({ ...base, isCommissioner: false })).toBe(false)
    expect(shouldStartPostCreateWelcome({ ...base, createdFromLeagueCreate: false })).toBe(false)
    expect(shouldStartPostCreateWelcome({ ...base, embedMode: true })).toBe(false)
    expect(shouldStartPostCreateWelcome({ ...base, defaultShowInvite: false, shouldPlayIntro: false })).toBe(false)
  })
})

describe('exactly one intro', () => {
  it('finds the format intros a league mounts, highest priority first', () => {
    expect(firstEntryIntroKinds({ leagueVariant: 'survivor' })).toEqual(['survivor'])
    expect(firstEntryIntroKinds({ leagueVariant: 'big_brother' })).toEqual(['big_brother'])
    expect(firstEntryIntroKinds({ leagueVariant: 'idp', guillotineMode: true })).toEqual(['guillotine', 'idp'])
    expect(firstEntryIntroKinds({ leagueVariant: 'merged_devy_c2c' })).toEqual(['c2c'])
    expect(firstEntryIntroKinds({ leagueType: 'devy' })).toEqual(['devy'])
    expect(firstEntryIntroKinds({ leagueVariant: 'devy_dynasty' })).toEqual(['devy'])
    expect(firstEntryIntroKinds({ leagueVariant: 'dynasty_idp' })).toEqual(['idp'])
    expect(firstEntryIntroKinds({ leagueType: 'redraft' })).toEqual([])
  })

  it('plays the first unseen format intro, else the concept intro', () => {
    expect(chooseWelcomeIntro(['guillotine', 'idp'], 'L1', 'u1')).toBe('guillotine')
    markFirstEntryIntrosSeen(['guillotine'], 'L1', 'u1')
    expect(chooseWelcomeIntro(['guillotine', 'idp'], 'L1', 'u1')).toBe('idp')
    markFirstEntryIntrosSeen(['idp'], 'L1', 'u1')
    expect(chooseWelcomeIntro(['guillotine', 'idp'], 'L1', 'u1')).toBeNull()
    expect(chooseWelcomeIntro([], 'L1', 'u1')).toBeNull()
  })

  it('the modals read the SAME seen key the flow writes — so none pops up after the sheet', () => {
    const view = render(<SurvivorFirstEntryModal leagueId="L1" userId="u1" enabled onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /survivor league intro/i })).toBeTruthy()
    view.unmount()

    markFirstEntryIntrosSeen(['survivor', 'guillotine'], 'L1', 'u1')
    expect(window.localStorage.getItem(firstEntryIntroStorageKey('survivor', 'L1', 'u1'))).toBe('1')
    render(<SurvivorFirstEntryModal leagueId="L1" userId="u1" enabled onClose={vi.fn()} />)
    render(<GuillotineFirstEntryModal leagueId="L1" show onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the existing seen keys, so nobody who already watched an intro sees it again', () => {
    expect(firstEntryIntroStorageKey('survivor', 'L1', 'u1')).toBe('survivor_intro_seen_L1_u1')
    expect(firstEntryIntroStorageKey('big_brother', 'L1', 'u1')).toBe('bb_intro_seen_L1_u1')
    expect(firstEntryIntroStorageKey('idp', 'L1', 'u1')).toBe('idp_intro_seen_L1_u1')
    expect(firstEntryIntroStorageKey('devy', 'L1', 'u1')).toBe('devy_intro_seen_L1_u1')
    expect(firstEntryIntroStorageKey('c2c', 'L1', 'u1')).toBe('c2c_intro_seen_L1_u1')
    expect(firstEntryIntroStorageKey('guillotine', 'L1', 'u1')).toBe('guillotine_intro_seen_L1')
  })

  it('a format intro closing hands over to the welcome sheet', () => {
    const onClose = vi.fn()
    render(<SurvivorFirstEntryModal leagueId="L2" userId="u1" enabled onClose={onClose} />)
    fireEvent.click(screen.getByTestId('survivor-intro-continue'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('the concept intro tells the flow when it is over', () => {
  function stubIntroStatus(seen: boolean) {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return { ok: true, json: async () => ({ seen }) } as Response
    }))
    return calls
  }
  const gate = (onSettled: () => void, settings?: unknown) => (
    <LeagueConceptIntroGate leagueId="L1" shouldPlayIntro leagueType="redraft" sport="NFL" settings={settings} onSettled={onSettled} />
  )

  it('already seen: settles without opening', async () => {
    stubIntroStatus(true)
    const onSettled = vi.fn()
    render(gate(onSettled))
    await waitFor(() => expect(onSettled).toHaveBeenCalled())
    expect(screen.queryByTestId('concept-intro-overlay')).toBeNull()
  })

  it('skipped: marks seen on the server, then settles', async () => {
    const calls = stubIntroStatus(false)
    const onSettled = vi.fn()
    render(gate(onSettled))
    await screen.findByTestId('concept-intro-overlay')
    expect(onSettled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('concept-intro-skip'))
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(calls.some((c) => c.startsWith('POST') && c.includes('intro-seen'))).toBe(true)
  })

  it('a clip that fails to load settles WITHOUT marking the intro seen', async () => {
    const calls = stubIntroStatus(false)
    const onSettled = vi.fn()
    render(gate(onSettled))
    fireEvent.error(await screen.findByTestId('concept-intro-video'))
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('concept-intro-overlay')).toBeNull()
    expect(calls.some((c) => c.includes('intro-seen'))).toBe(false)
  })

  it('intros switched off for the league: settles straight away', async () => {
    stubIntroStatus(false)
    const onSettled = vi.fn()
    render(gate(onSettled, { introVideoEnabled: false }))
    await waitFor(() => expect(onSettled).toHaveBeenCalled())
  })

  it('Escape skips, and the clip offers sound because autoplay must start muted', () => {
    const onDismiss = vi.fn()
    render(<ConceptIntroVideoOverlay open conceptLabel="Survivor" videoSrc="/x.mp4" onDismiss={onDismiss} />)
    const video = screen.getByTestId('concept-intro-video') as HTMLVideoElement
    expect(video.muted).toBe(true)
    fireEvent.click(screen.getByTestId('concept-intro-unmute'))
    expect(video.muted).toBe(false)
    expect(screen.queryByTestId('concept-intro-unmute')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('one invite link, every way to send it', () => {
  it('builds the link from the league code on this host, with the code alone', () => {
    expect(nativeLeagueInviteCode({ inviteCode: ' ABC123 ' }, [{ token: 'TOK', isActive: true }])).toBe('ABC123')
    expect(nativeLeagueInviteCode({}, [{ token: 'OLD', isActive: false }, { token: 'TOK', isActive: true }])).toBe('TOK')
    expect(nativeLeagueInviteCode(null, [])).toBe('')
    expect(leagueJoinUrl('A B', 'http://127.0.0.1:3917/')).toBe('http://127.0.0.1:3917/join?code=A%20B')
    expect(leagueJoinUrl('')).toBe('')
  })

  it('text and WhatsApp carry the message and the link, encoded', () => {
    const message = inviteShareMessage('Tight End Club')
    expect(message).toBe('Join my fantasy league "Tight End Club" on AllFantasy:')
    expect(smsInviteHref(message, 'https://x.test/join?code=A')).toBe(`sms:?&body=${encodeURIComponent(`${message} https://x.test/join?code=A`)}`)
    expect(whatsAppInviteHref(message, 'https://x.test/join?code=A')).toContain('https://wa.me/?text=')
    expect(inviteShareMessage('')).toBe('Join my fantasy league on AllFantasy:')
  })

  it('counts claimed seats, never the placeholder slots create makes', () => {
    expect(countClaimedSeats([{ claimedByUserId: 'u1' }, { claimedByUserId: null }, {}])).toBe(1)
    expect(countClaimedSeats(null)).toBe(0)
  })

  it('shows the QR, text and WhatsApp; the share button only where the phone has a share sheet', async () => {
    const view = render(<LeagueInviteShare url="https://x.test/join?code=A" leagueName="Club" filled={1} total={12} />)
    expect(screen.getByTestId('league-invite-qr')).toBeTruthy()
    expect(screen.getByTestId('league-invite-seats').textContent).toBe('1 of 12 managers joined')
    expect(screen.getByTestId('league-invite-sms').getAttribute('href')).toMatch(/^sms:\?&body=/)
    expect(screen.getByTestId('league-invite-whatsapp').getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(screen.queryByTestId('league-invite-share')).toBeNull()
    view.unmount()

    const share = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, share })
    render(<LeagueInviteShare url="https://x.test/join?code=A" leagueName="Club" />)
    fireEvent.click(await screen.findByTestId('league-invite-share'))
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.test/join?code=A', title: 'Club' })))
    await screen.findByText('Invite sent.')
  })

  it('cancelling the share sheet is not reported as anything', async () => {
    vi.stubGlobal('navigator', { ...navigator, share: vi.fn(async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }) }) })
    render(<LeagueInviteShare url="https://x.test/join?code=A" />)
    fireEvent.click(await screen.findByTestId('league-invite-share'))
    await act(async () => {})
    expect(screen.getByTestId('league-invite-status').textContent).toBe('')
  })

  it('Copy says Copied only when it worked, and tells you what to do when it did not', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const view = render(<LeagueInviteShare url="https://x.test/join?code=A" />)
    fireEvent.click(screen.getByTestId('league-invite-copy'))
    await screen.findByText('Invite link copied.')
    expect(writeText).toHaveBeenCalledWith('https://x.test/join?code=A')
    view.unmount()

    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    document.execCommand = vi.fn(() => false)
    render(<LeagueInviteShare url="https://x.test/join?code=A" />)
    fireEvent.click(screen.getByTestId('league-invite-copy'))
    await screen.findByText(/press and hold the link/i)
  })

  it('falls back to selecting the field when the clipboard API is missing', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    document.execCommand = vi.fn(() => true)
    const field = document.createElement('input')
    field.value = 'https://x.test/join?code=A'
    document.body.appendChild(field)
    expect(await copyInviteText(field.value, field)).toBe('copied')
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })
})

describe('"your league is ready"', () => {
  const league: PostCreateWelcomeLeague = {
    id: 'L1',
    name: 'Tight End Club',
    sport: 'NFL',
    formatLabel: 'Redraft',
    teamCount: 12,
    claimedSeats: 1,
    scoringLabel: 'Full PPR',
    tePremiumPoints: 0.5,
    draftDateIso: null,
    timezone: 'America/Chicago',
    privacy: 'private',
  }

  it('says what was created, offers the invite, and points at the draft time when there is none', () => {
    const onOpenSettings = vi.fn()
    const onClose = vi.fn()
    render(<PostCreateWelcomeSheet league={league} inviteUrl="https://x.test/join?code=A" onClose={onClose} onOpenSettings={onOpenSettings} />)
    expect(screen.getByRole('dialog', { name: 'Tight End Club is ready' })).toBeTruthy()
    const info = screen.getByTestId('post-create-welcome-info').textContent ?? ''
    for (const text of ['NFL · Redraft', '1 of 12 managers joined', 'Full PPR · TE premium +0.5 per catch', 'Not scheduled yet', 'Private (invite only)']) {
      expect(info).toContain(text)
    }
    expect(screen.getByTestId('post-create-invite-qr')).toBeTruthy()
    fireEvent.click(screen.getByTestId('post-create-welcome-set-draft'))
    expect(onOpenSettings).toHaveBeenCalledWith('draft')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('with a draft time it shows it in the league timezone and drops the set-draft step', () => {
    render(
      <PostCreateWelcomeSheet
        league={{ ...league, draftDateIso: '2026-11-09T02:00:00.000Z', tePremiumPoints: null }}
        inviteUrl=""
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('post-create-welcome-set-draft')).toBeNull()
    expect(screen.getByTestId('post-create-welcome-info').textContent).toContain('8:00')
    expect(screen.getByTestId('post-create-invite-no-link')).toBeTruthy()
  })

  it('offers to list the league in Find a League while it has open seats', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return new Response(JSON.stringify({ listed: false, inviteReady: true, openSeats: 11, leagueSize: 12, seatsHeld: 1 }))
    }))
    render(<PostCreateWelcomeSheet league={league} inviteUrl="https://x.test/join?code=A" onClose={vi.fn()} onOpenSettings={vi.fn()} />)
    expect((await screen.findByTestId('find-league-listing-seats')).textContent).toBe('11 open seats')
    fireEvent.click(screen.getByTestId('find-league-listing-toggle'))
    await waitFor(() => expect(calls).toContain('POST /api/commissioner/leagues/L1/league-finder'))
  })

  it('formats the draft date in the league zone, and survives a bad zone', () => {
    expect(formatWelcomeDraftDate('2026-11-09T02:00:00.000Z', 'America/Chicago', 'en-US')).toMatch(/Sun, Nov 8, 8:00\s?PM CST/)
    expect(formatWelcomeDraftDate('2026-11-09T02:00:00.000Z', 'Not/AZone', 'en-US')).toBeTruthy()
    expect(formatWelcomeDraftDate(null, 'America/Chicago')).toBeNull()
  })
})
