import { describe, expect, it } from 'vitest'
import { canViewerSeeWhisperer } from '@/lib/zombie/whispererVisibility'
import { describeZombieLeaguePhase } from '@/lib/zombie/zombieLeaguePhase'

const member = { viewerIsCommissioner: false, viewerIsWhisperer: false }

describe('canViewerSeeWhisperer', () => {
  it('hides the Whisperer in a secret league even though the record says revealed', () => {
    expect(canViewerSeeWhisperer({ whispererIsPublic: false, isPubliclyRevealed: true, ...member })).toBe(false)
  })

  it('shows the Whisperer in a public league once revealed', () => {
    expect(canViewerSeeWhisperer({ whispererIsPublic: true, isPubliclyRevealed: true, ...member })).toBe(true)
  })

  it('hides the Whisperer in a public league while the record is unrevealed', () => {
    expect(canViewerSeeWhisperer({ whispererIsPublic: true, isPubliclyRevealed: false, ...member })).toBe(false)
  })

  it('treats a public league with no record as revealed, like the league home page', () => {
    expect(canViewerSeeWhisperer({ whispererIsPublic: true, isPubliclyRevealed: null, ...member })).toBe(true)
  })

  it('fails closed when the league setting is unknown', () => {
    expect(canViewerSeeWhisperer({ whispererIsPublic: undefined, isPubliclyRevealed: true, ...member })).toBe(false)
  })

  it('always lets the head commissioner and the Whisperer know', () => {
    expect(
      canViewerSeeWhisperer({ whispererIsPublic: false, isPubliclyRevealed: false, viewerIsCommissioner: true, viewerIsWhisperer: false }),
    ).toBe(true)
    expect(
      canViewerSeeWhisperer({ whispererIsPublic: false, isPubliclyRevealed: false, viewerIsCommissioner: false, viewerIsWhisperer: true }),
    ).toBe(true)
  })
})

describe('describeZombieLeaguePhase', () => {
  it('marks setup as before the season', () => {
    expect(describeZombieLeaguePhase('setup')).toMatchObject({ status: 'setup', beforeSeason: true })
  })

  it('describes registering by what automation does in it', () => {
    const phase = describeZombieLeaguePhase('registering')
    expect(phase.beforeSeason).toBe(false)
    expect(phase.meaning).toContain('automation runs')
  })

  it('says a paused league resolves nothing new', () => {
    expect(describeZombieLeaguePhase('paused').meaning).toContain('does not run')
  })

  it('reports an unrecognised status raw without inventing a meaning', () => {
    expect(describeZombieLeaguePhase('frozen_by_admin')).toMatchObject({
      status: 'frozen_by_admin',
      label: 'frozen_by_admin',
      meaning: 'Unrecognised league status. Do not infer what it means.',
    })
  })

  it('reports a missing status as unknown', () => {
    expect(describeZombieLeaguePhase(null)).toMatchObject({ status: 'unknown', beforeSeason: false })
  })
})
