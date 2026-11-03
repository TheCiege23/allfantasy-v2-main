/**
 * F.1 — DEF avatar special case.
 *
 * For NFL team defenses (`position === 'DEF'`), the team logo IS the correct
 * primary avatar. This test verifies:
 *   - the pure helper `isDefRowForAvatar()` returns true only for 'DEF'
 *   - PlayerAvatar promotes the team logo to the primary slot AND suppresses
 *     the duplicate bottom-right badge for DEF rows
 *   - call sites (SleeperPoolTable, PlayerDetailModal, DraftBoardCell) thread
 *     `position` into PlayerAvatar
 *   - DraftBoardCell draws no team-logo corner badge (so no duplicate logo for DEF picks)
 *   - normal players (RB/WR/QB/TE/K, IDP positions) still reject team logos
 *     as the primary avatar — the global validation is intact
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDefRowForAvatar } from '@/lib/draft-room/classify-avatar-source'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('F.1 — isDefRowForAvatar (pure helper)', () => {
  it('exact "DEF" → true', () => {
    expect(isDefRowForAvatar('DEF')).toBe(true)
  })

  it('case- and whitespace-tolerant', () => {
    expect(isDefRowForAvatar('def')).toBe(true)
    expect(isDefRowForAvatar('  Def  ')).toBe(true)
    expect(isDefRowForAvatar('\tDEF\n')).toBe(true)
  })

  it('null / undefined / empty → false', () => {
    expect(isDefRowForAvatar(null)).toBe(false)
    expect(isDefRowForAvatar(undefined)).toBe(false)
    expect(isDefRowForAvatar('')).toBe(false)
    expect(isDefRowForAvatar('   ')).toBe(false)
  })

  it('regular skill positions → false (no team-logo substitution)', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'PK']) {
      expect(isDefRowForAvatar(pos)).toBe(false)
    }
  })

  it('IDP positions → false (DL/LB/DB/CB/S are individual players, not defenses)', () => {
    for (const pos of ['DL', 'LB', 'DB', 'CB', 'S', 'DE', 'DT', 'NT', 'OLB', 'ILB']) {
      expect(isDefRowForAvatar(pos)).toBe(false)
    }
  })

  it('legacy "D/ST" alias does NOT match — normalizer is expected to collapse it to DEF first', () => {
    // The pool resolver normalizes positions; if "D/ST" sneaks through it should NOT
    // accidentally promote a team logo. This guards against silent mis-categorization.
    expect(isDefRowForAvatar('D/ST')).toBe(false)
    expect(isDefRowForAvatar('DST')).toBe(false)
  })
})

describe('F.1 — PlayerAvatar DEF branch (static-source)', () => {
  const src = read('components/app/draft-room/PlayerAvatar.tsx')

  it('accepts an optional `position` prop', () => {
    expect(src).toMatch(/position\?: string \| null/)
  })

  it('uses the shared isDefRowForAvatar helper (single source of truth)', () => {
    expect(src).toMatch(/isDefRowForAvatar\(position\)/)
    expect(src).toMatch(/from '@\/lib\/draft-room\/classify-avatar-source'/)
  })

  it('only promotes the team logo when DEF AND the team-logo URL is usable', () => {
    // showDefLogoAsPrimary = isDefRow && showTeamLogo && !defLogoError
    // — that compound gate is what guarantees normal players never get a logo
    //   as their primary avatar regardless of position prop.
    expect(src).toMatch(/showDefLogoAsPrimary\s*=\s*isDefRow\s*&&\s*showTeamLogo\s*&&\s*!defLogoError/)
  })

  it('renders the team logo via LazyDraftImage in the DEF branch', () => {
    expect(src).toMatch(/showDefLogoAsPrimary\s*\?\s*\(\s*<LazyDraftImage[\s\S]*?src=\{String\(teamLogoUrl\)\}/)
  })

  it('suppresses the bottom-right badge for DEF rows (showBadge = !isDefRow)', () => {
    expect(src).toMatch(/showBadge\s*=\s*!isDefRow/)
    expect(src).toMatch(/showBadge && showTeamLogo/)
    expect(src).toMatch(/showBadge && teamAbbr/)
  })

  it('exposes data-position="DEF" for QA / e2e selectors', () => {
    expect(src).toMatch(/data-position=\{isDefRow \? 'DEF' : undefined\}/)
  })

  it('exposes a distinct data-avatar-source value for DEF (def_team_logo)', () => {
    expect(src).toMatch(/data-avatar-source=\{[\s\S]*?showDefLogoAsPrimary \? 'def_team_logo'/)
  })

  it('falls back to initials/silhouette when DEF but no usable logo', () => {
    // The DEF branch is gated by showTeamLogo; when it's false the component
    // falls through to the existing showImg/initials path. We assert the
    // fallback gate is preserved (showImg uses !showDefLogoAsPrimary).
    expect(src).toMatch(/const showImg = !showDefLogoAsPrimary && source === 'headshot' && !imgError/)
  })

  it('logo error handler resets to fallback (DEF logo can fail to load)', () => {
    expect(src).toMatch(/onError=\{\(\) => setDefLogoError\(true\)\}/)
  })
})

describe('F.1 — call sites thread `position` into PlayerAvatar', () => {
  it('SleeperPoolTable passes position={p.position}', () => {
    const src = read('components/app/draft-room/SleeperPoolTable.tsx')
    expect(src).toMatch(/<PlayerAvatar[\s\S]*?position=\{p\.position\}[\s\S]*?\/>/)
  })

  it('PlayerDetailModal passes position={player.position ?? null}', () => {
    const src = read('components/app/draft-room/PlayerDetailModal.tsx')
    expect(src).toMatch(/position=\{player\.position \?\? null\}/)
  })

  it('DraftBoardCell threads position + teamLogoUrl into TinyHeadshot', () => {
    const src = read('components/app/draft-room/DraftBoardCell.tsx')
    expect(src).toMatch(/<TinyHeadshot[\s\S]*?position=\{pick\.position\}[\s\S]*?teamLogoUrl=\{teamLogoSrc\}/)
  })

  it('DraftBoardCell draws no team-logo corner badge, so DEF picks never show the logo twice', () => {
    // The square tiles (2026-10-28) dropped the corner badge for every position: the team is
    // printed under the name, and the badge covered the headshot's initials.
    const src = read('components/app/draft-room/DraftBoardCell.tsx')
    expect(src).not.toMatch(/<TinyTeamLogo/)
  })

  it('TinyHeadshot wrapper accepts position + teamLogoUrl + teamAbbr props', () => {
    const src = read('components/app/draft-room/DraftBoardCell.tsx')
    expect(src).toMatch(/position\?: string \| null/)
    expect(src).toMatch(/teamLogoUrl\?: string \| null/)
    expect(src).toMatch(/teamAbbr\?: string \| null/)
  })
})

describe('F.1 — global validation NOT weakened (regression guard)', () => {
  const classifierSrc = read('lib/draft-room/classify-avatar-source.ts')
  const avatarSrc = read('components/app/draft-room/PlayerAvatar.tsx')

  it('classifyAvatarSource still returns team_logo_badge_only for /teamLogos/ paths', () => {
    // Helper still routes team logos to the badge-only classification — the DEF
    // branch is the ONLY place that promotes one to the primary slot.
    expect(classifierSrc).toMatch(/return 'team_logo_badge_only'/)
  })

  it('PlayerAvatar still rejects team-logo URLs in the headshot slot for non-DEF rows', () => {
    // showImg requires source === 'headshot'. Team logos classify as
    // 'team_logo_badge_only' so they cannot enter the headshot path even
    // when position is missing/null.
    expect(avatarSrc).toMatch(/source === 'headshot'/)
  })

  it('non-DEF rows do not use the def_team_logo data attribute (only DEF flips it)', () => {
    // The ternary always anchors on showDefLogoAsPrimary, which requires
    // isDefRow=true. No alternate branch can sneak into 'def_team_logo'.
    expect(avatarSrc).toMatch(/showDefLogoAsPrimary \? 'def_team_logo' : showImg \? 'headshot' : 'fallback'/)
  })
})

describe('F.1 — no forbidden BaaS references', () => {
  const FORBIDDEN = 'supa' + 'base'
  const filesToCheck = [
    'components/app/draft-room/PlayerAvatar.tsx',
    'components/app/draft-room/DraftBoardCell.tsx',
    'lib/draft-room/classify-avatar-source.ts',
  ]
  for (const rel of filesToCheck) {
    it(`${rel} contains no forbidden BaaS imports`, () => {
      const src = read(rel)
      expect(src.toLowerCase()).not.toContain(FORBIDDEN)
    })
  }
})
