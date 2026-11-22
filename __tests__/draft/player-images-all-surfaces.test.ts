import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `feat/player-images-all-surfaces` — UI coverage sweep.
 *
 * Whenever a player's name appears on a primary surface, the player's headshot must
 * also appear via the shared fallback chain (real headshot → silhouette+initials →
 * DEF team-logo promotion). This suite asserts each migrated surface either
 *   (a) imports the shared `PlayerAvatar` (or `PlayerHeadshot`) component, or
 *   (b) no longer contains a raw `<img` tag for player rendering.
 *
 * The audited surfaces and their categories (see audit table on PR description):
 *   Gap A — bypass (raw <img> present, swapped to PlayerAvatar):
 *     - components/app/draft-room/QueuePanel.tsx
 *     - components/app/draft-room/DraftChatPanel.tsx (pick announcements + playerContext)
 *   Gap B — name-only (no image, added PlayerAvatar next to name):
 *     - app/league/[leagueId]/tabs/redraft/WaiverCenter.tsx
 *     - components/app/draft-room/DraftRosterStrip.tsx
 *
 * Companion: PR #16 covers DATA backfill (cron + provider chain). This PR
 * covers RENDER coverage. The two pair to give: every name → every image.
 */

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const PLAYER_AVATAR_IMPORT = /from ['"](?:\.\/PlayerAvatar|@\/components\/app\/draft-room\/PlayerAvatar)['"]/

describe('player-images-all-surfaces — Gap A (raw <img> swapped to shared PlayerAvatar)', () => {
  it('QueuePanel imports + uses PlayerAvatar and no longer renders a raw <img> for queue rows', () => {
    const src = read('components/app/draft-room/QueuePanel.tsx')
    expect(src).toMatch(PLAYER_AVATAR_IMPORT)
    expect(src).toMatch(/<PlayerAvatar\b/)
    // No raw <img tags allowed in QueuePanel — this surface only renders player rows.
    expect(src).not.toMatch(/<img\b/)
  })

  it('DraftChatPanel imports PlayerAvatar and uses it for both pick events and playerContext', () => {
    const src = read('components/app/draft-room/DraftChatPanel.tsx')
    expect(src).toMatch(PLAYER_AVATAR_IMPORT)
    // Pick-announcement card uses PlayerAvatar with the canonical testIdBase
    expect(src).toMatch(/testIdBase="draft-chat-pick-headshot"/)
    // playerContext card uses PlayerAvatar (separate testIdBase)
    expect(src).toMatch(/testIdBase="draft-chat-player-context-avatar"/)
    // The two formerly-raw player <img> blocks are gone. (Chat media — memes/gifs —
    // is intentionally exempt; that block is a media attachment, not a player image.)
    expect(src).not.toMatch(/data-testid="draft-chat-pick-headshot"/)
  })
})

describe('player-images-all-surfaces — Gap B (name-only surfaces, image added)', () => {

  it('WaiverCenter renders PlayerAvatar next to each waiver target name', () => {
    const src = read('app/league/[leagueId]/tabs/redraft/WaiverCenter.tsx')
    expect(src).toMatch(PLAYER_AVATAR_IMPORT)
    expect(src).toMatch(/<PlayerAvatar\b/)
    // API parsing should pick up headshot fields from any of the common keys
    expect(src).toMatch(/headshotUrl: p\.headshotUrl \?\? p\.imageUrl \?\? p\.photoUrl \?\? null/)
  })

  it('DraftRosterStrip renders PlayerAvatar next to each filled roster slot', () => {
    const src = read('components/app/draft-room/DraftRosterStrip.tsx')
    expect(src).toMatch(/from '\.\/PlayerAvatar'/)
    expect(src).toMatch(/<PlayerAvatar\b/)
    // Pick type extended with optional image fields so parents can hydrate them.
    expect(src).toMatch(/headshotUrl\?: string \| null/)
    expect(src).toMatch(/teamLogoUrl\?: string \| null/)
  })
})

describe('player-images-all-surfaces — fallback chain remains centralized', () => {
  it('PlayerAvatar still owns the silhouette/initials/DEF-logo fallback chain', () => {
    const src = read('components/app/draft-room/PlayerAvatar.tsx')
    expect(src).toMatch(/classifyAvatarSource/)
    expect(src).toMatch(/initialsFor/)
    expect(src).toMatch(/isDefRowForAvatar/)
  })
})
