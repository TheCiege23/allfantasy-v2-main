import { describe, expect, it } from 'vitest'
import {
  clipHandlesFor,
  isClipSearchDue,
  parseXPostUrl,
  pickFromCitations,
  summarizeClipPilot,
  validateClipCandidate,
  type ClipPilotRecord,
} from '@/lib/live/tdClipMatch'

/** A status id minted at a given instant — the inverse of the snowflake decode. */
function idAt(iso: string): string {
  return ((BigInt(new Date(iso).getTime()) - 1288834974657n) << 22n).toString()
}

const PLAY = '2026-09-27T18:00:00.000Z'
const HANDLES = ['NFL', 'Chiefs', 'BuffaloBills']

describe('parseXPostUrl', () => {
  it('dates a real xAI citation id from the id alone', () => {
    // Quoted in lib/ai/xNewsSearch.ts from a live response on 2026-08-27 (48h lookback).
    const post = parseXPostUrl('https://x.com/i/status/2092371465660236156')
    expect(post?.handle).toBeNull()
    expect(post?.postedAt).toBe('2026-08-25T22:00:06.452Z')
  })

  it('reads the handle form, twitter.com, and media suffixes', () => {
    const id = idAt(PLAY)
    expect(parseXPostUrl(`https://x.com/NFL/status/${id}`)?.handle).toBe('NFL')
    expect(parseXPostUrl(`https://twitter.com/Chiefs/status/${id}/video/1`)?.handle).toBe('Chiefs')
    expect(parseXPostUrl(`https://mobile.twitter.com/Chiefs/status/${id}`)?.url).toBe(`https://x.com/Chiefs/status/${id}`)
  })

  it('refuses what is not an X post', () => {
    expect(parseXPostUrl('https://www.youtube.com/watch?v=NUvZpCNjH38')).toBeNull()
    expect(parseXPostUrl('https://x.com/NFL')).toBeNull()
    expect(parseXPostUrl('https://evilx.com/NFL/status/123456789')).toBeNull()
    expect(parseXPostUrl(null)).toBeNull()
  })
})

describe('validateClipCandidate', () => {
  it('accepts an official post made after the play, with its lag', () => {
    const v = validateClipCandidate(`https://x.com/NFL/status/${idAt('2026-09-27T18:03:00.000Z')}`, { allowedHandles: HANDLES, detectedAt: PLAY })
    expect(v.ok && v.lagSeconds).toBe(180)
  })

  it('rejects a post from before the play — last week\'s clip of the same player', () => {
    const v = validateClipCandidate(`https://x.com/NFL/status/${idAt('2026-09-20T18:03:00.000Z')}`, { allowedHandles: HANDLES, detectedAt: PLAY })
    expect(v.ok ? null : v.reason).toBe('posted-before-play')
  })

  it('rejects an account outside the search, and a post hours later', () => {
    const fan = validateClipCandidate(`https://x.com/SomeFanPage/status/${idAt(PLAY)}`, { allowedHandles: HANDLES, detectedAt: PLAY })
    expect(fan.ok ? null : fan.reason).toBe('handle-not-allowed')
    const late = validateClipCandidate(`https://x.com/NFL/status/${idAt('2026-09-27T23:00:00.000Z')}`, { allowedHandles: HANDLES, detectedAt: PLAY })
    expect(late.ok ? null : late.reason).toBe('posted-too-late')
  })
})

describe('pickFromCitations', () => {
  const cited = `https://x.com/Chiefs/status/${idAt('2026-09-27T18:04:00.000Z')}`

  it('accepts the model\'s pick only when the search returned it', () => {
    const r = pickFromCitations(cited, [cited], { allowedHandles: HANDLES, detectedAt: PLAY })
    expect(r.accepted?.handle).toBe('Chiefs')
  })

  it('refuses a pick the search never returned, however plausible', () => {
    const invented = `https://x.com/NFL/status/${idAt('2026-09-27T18:05:00.000Z')}`
    const r = pickFromCitations(invented, [cited], { allowedHandles: HANDLES, detectedAt: PLAY })
    expect(r.accepted).toBeNull()
  })

  it('matches the pick to a citation by status id, whatever URL shape either uses', () => {
    const iForm = cited.replace('/Chiefs/', '/i/')
    const r = pickFromCitations(iForm, [cited], { allowedHandles: HANDLES, detectedAt: PLAY })
    expect(r.accepted?.url).toBe(cited)
  })
})

describe('isClipSearchDue', () => {
  const t = (min: number) => new Date(PLAY).getTime() + min * 60_000
  const record = (attempts: number, extra: Partial<ClipPilotRecord> = {}) =>
    ({ detectedAt: PLAY, attempts: Array.from({ length: attempts }, () => ({})), found: false, claimedAt: null, ...extra }) as ClipPilotRecord

  it('waits five minutes, then retries once at thirty, then stops', () => {
    expect(isClipSearchDue(null, PLAY, t(2))).toBe(false)
    expect(isClipSearchDue(null, PLAY, t(6))).toBe(true)
    expect(isClipSearchDue(record(1), PLAY, t(20))).toBe(false)
    expect(isClipSearchDue(record(1), PLAY, t(31))).toBe(true)
    expect(isClipSearchDue(record(2), PLAY, t(90))).toBe(false)
  })

  it('never searches again once found, past four hours, or while claimed', () => {
    expect(isClipSearchDue(record(1, { found: true }), PLAY, t(31))).toBe(false)
    expect(isClipSearchDue(null, PLAY, t(5 * 60))).toBe(false)
    expect(isClipSearchDue(record(0, { claimedAt: new Date(t(5)).toISOString() }), PLAY, t(6))).toBe(false)
  })
})

describe('clipHandlesFor', () => {
  it('is the league plus both teams, through the abbreviation aliases', () => {
    expect(clipHandlesFor('KC', 'WSH')).toEqual(['NFL', 'Chiefs', 'Commanders'])
    expect(clipHandlesFor(null, null)).toEqual(['NFL'])
  })
})

describe('summarizeClipPilot', () => {
  it('tallies hits by attempt and by team, and lists links for review', () => {
    const accepted = { url: 'https://x.com/NFL/status/1', handle: 'NFL', postedAt: PLAY, lagSeconds: 120 }
    const base = { version: 1, gameId: 'g', opponent: null, detectedAt: PLAY, handles: [], starterOwners: 1 } as const
    const records: ClipPilotRecord[] = [
      { ...base, playId: 'a', playerName: 'A', team: 'KC', headline: 'A TD', found: true, attempts: [
        { at: PLAY, ok: true, modelPick: accepted.url, accepted, citations: [], rejected: [], latencyMs: 4000, costTicks: 10 },
      ] },
      { ...base, playId: 'b', playerName: 'B', team: 'KC', headline: 'B TD', found: true, attempts: [
        { at: PLAY, ok: true, modelPick: null, accepted: null, citations: [], rejected: [{ url: 'x', reason: 'posted-before-play' }], latencyMs: 6000 },
        { at: PLAY, ok: true, modelPick: accepted.url, accepted: { ...accepted, lagSeconds: 600 }, citations: [], rejected: [], latencyMs: 5000 },
      ] },
      { ...base, playId: 'c', playerName: 'C', team: 'BUF', headline: 'C TD', found: false, attempts: [
        { at: PLAY, ok: false, error: 'xAI HTTP 500', modelPick: null, accepted: null, citations: [], rejected: [], latencyMs: 25000 },
      ] },
    ]
    const s = summarizeClipPilot(records)
    expect(s).toMatchObject({ touchdowns: 3, searches: 4, found: 2, foundOnFirstAttempt: 1, foundOnRetry: 1, failedSearches: 1, costTicksTotal: 10 })
    expect(s.byTeam).toEqual({ KC: { searched: 2, found: 2 }, BUF: { searched: 1, found: 0 } })
    expect(s.rejectedByReason).toEqual({ 'posted-before-play': 1 })
    expect(s.foundLinks.map((l) => l.attempt)).toEqual([1, 2])
  })
})
