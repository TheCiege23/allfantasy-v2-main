/**
 * NFL redraft league dashboard — shared player-headshot resolver lock (Commit C).
 *
 * Roster (TeamTab) and Players/Waivers (PlayersTab) must render player images
 * through the shared `<PlayerHeadshot>` component, NOT directly through
 * `<PlayerImage>` or hard-coded `https://sleepercdn.com/...` URLs. Going
 * through the shared component guarantees the multi-tier fallback chain
 * (TheSportsDB → ClearSports → Sleeper → ESPN → initials placeholder) and a
 * stable empty state, with the server resolver opt-in isolated to the NFL
 * redraft dashboard tabs.
 *
 * Static-source assertions only — JSDOM-rendering the tabs would pull in the
 * full league context tree, which is beyond the scope of a regression lock.
 *
 * Browser smoke is covered by the Playwright spec at
 * `e2e/nfl-redraft-league-dashboard-settings-gear.spec.ts` plus the new
 * media smoke (added in this commit).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('NFL redraft core — TeamTab uses PlayerHeadshot, not PlayerImage', () => {
  const src = read('app/league/[leagueId]/tabs/TeamTab.tsx')

  it('imports PlayerHeadshot from the shared league component path', () => {
    expect(src).toMatch(
      /import \{ PlayerHeadshot \} from '@\/components\/league\/PlayerHeadshot'/,
    )
  })

  it('does not import the underlying PlayerImage directly', () => {
    expect(src).not.toMatch(/from '@\/app\/components\/PlayerImage'/)
  })

  it('renders <PlayerHeadshot> in the roster row, not <PlayerImage>', () => {
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?playerId=\{playerId\}/)
    expect(src).not.toMatch(/<PlayerImage[\s\S]*?playerId=\{playerId\}/)
  })

  it('forwards player name + position + team to the shared component', () => {
    // Names matter — the chain falls back to initials when every provider
    // 404s, and the alt text drives screen-reader output.
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?useResolver=\{String\(sport \?\? ''\)\.trim\(\)\.toUpperCase\(\) === 'NFL'\}/)
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?playerName=\{label\}/)
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?position=\{resolved\.position\}/)
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?team=\{resolved\.team\}/)
  })

  it('does not hard-code sleepercdn.com URLs in roster row markup', () => {
    // Owner-avatar usage of sleepercdn.com is allowed (line ~846) — that is
    // a Sleeper user avatar, not a player image. Guard only the player path.
    const rosterRowSlice = src.slice(
      src.indexOf('function RosterRow'),
      src.indexOf("export function TeamTab"),
    )
    expect(rosterRowSlice).not.toMatch(/sleepercdn\.com\/content\/[a-z]+\/players/)
  })
})

describe('NFL redraft core — PlayersTab uses PlayerHeadshot, not PlayerImage', () => {
  const src = read('app/league/[leagueId]/tabs/PlayersTab.tsx')

  it('imports PlayerHeadshot from the shared league component path', () => {
    expect(src).toMatch(
      /import \{ PlayerHeadshot \} from '@\/components\/league\/PlayerHeadshot'/,
    )
  })

  it('does not import the underlying PlayerImage directly', () => {
    expect(src).not.toMatch(/from '@\/app\/components\/PlayerImage'/)
  })

  it('renders <PlayerHeadshot> in the player row, not <PlayerImage>', () => {
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?playerId=\{p\.id\}/)
    expect(src).not.toMatch(/<PlayerImage[\s\S]*?playerId=\{p\.id\}/)
  })

  it('forwards player name + position + team to the shared component', () => {
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?useResolver=\{sportU === 'NFL'\}/)
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?playerName=\{p\.name\}/)
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?position=\{p\.position\}/)
    expect(src).toMatch(/<PlayerHeadshot[\s\S]*?team=\{p\.team\}/)
  })

  it('does not hard-code sleepercdn.com player URLs', () => {
    expect(src).not.toMatch(/sleepercdn\.com\/content\/[a-z]+\/players/)
  })
})

describe('PlayerHeadshot — rich + legacy modes', () => {
  const src = read('components/league/PlayerHeadshot.tsx')

  it('exports the canonical PlayerHeadshotProps shape', () => {
    // The user spec calls out playerId / sleeperId / playerName / headshotUrl
    // / team. All must be optional props on the canonical type.
    expect(src).toMatch(/playerId\?:\s*string/)
    expect(src).toMatch(/sleeperId\?:\s*string/)
    expect(src).toMatch(/playerName\?:\s*string/)
    expect(src).toMatch(/headshotUrl\?:\s*string \| null/)
    expect(src).toMatch(/team\?:\s*string \| null/)
    expect(src).toMatch(/useResolver\?:\s*boolean/)
  })

  it('rich mode delegates to the underlying PlayerImage chain', () => {
    expect(src).toMatch(/import \{ PlayerImage \} from '@\/app\/components\/PlayerImage'/)
    expect(src).toMatch(/<PlayerImage[\s\S]*?sleeperId=\{id\}/)
  })

  it('rich mode can opt into the server-side resolver route before falling through to PlayerImage', () => {
    expect(src).toMatch(/fetchResolvedHeadshot/)
    expect(src).toMatch(/new URL\('\/api\/player\/resolve-headshot'/)
    expect(src).toMatch(/credentials:\s*'same-origin'/)
    expect(src).toMatch(/headshotUrl=\{resolvedHeadshotUrl \?\? undefined\}/)
  })

  it('legacy mode preserves the {src, alt, size} contract for older callers', () => {
    // 10+ existing callers (ActivityFeed, PlayerRow, TradeCard, StandingsRow,
    // PlayoffBracket, CollegePlayerRow, StartVsComparisonCard, etc.) pass a
    // pre-resolved src. Breaking this signature would break those surfaces.
    expect(src).toMatch(/src\?:\s*string \| null/)
    expect(src).toMatch(/<img[\s\S]*?src=\{props\.src\}/)
  })

  it('legacy mode renders a Shield silhouette when src is null (no infinite-error loop)', () => {
    expect(src).toMatch(/<Shield/)
    expect(src).toMatch(/role="img"/)
    expect(src).toMatch(/aria-label=\{alt \|\| 'Player'\}/)
  })

  it('default export is preserved for legacy default-import callers', () => {
    expect(src).toMatch(/export default PlayerHeadshot/)
  })
})

describe('/api/player/resolve-headshot route', () => {
  const src = read('app/api/player/resolve-headshot/route.ts')

  it('exports GET and POST handlers', () => {
    expect(src).toMatch(/export async function GET/)
    expect(src).toMatch(/export async function POST/)
  })

  it('gates on an authenticated next-auth session (no anonymous resolver fan-out)', () => {
    expect(src).toMatch(/import \{ getServerSession \} from 'next-auth'/)
    expect(src).toMatch(/if \(!session\?\.user\?\.id\)/)
    expect(src).toMatch(/Unauthorized/)
  })

  it('wraps lib/player-assets/resolvePlayerHeadshot — the canonical resolver', () => {
    expect(src).toMatch(
      /import \{[\s\S]*?resolvePlayerHeadshot[\s\S]*?\} from '@\/lib\/player-assets\/resolvePlayerHeadshot'/,
    )
    expect(src).toMatch(/await resolvePlayerHeadshot\(/)
  })

  it('returns the documented response shape: { headshotUrl, source, fallbackUsed, confidence }', () => {
    expect(src).toMatch(/headshotUrl: result\.imageUrl/)
    expect(src).toMatch(/source: result\.source/)
    expect(src).toMatch(/fallbackUsed:/)
    expect(src).toMatch(/confidence: result\.confidence/)
  })

  it('400s when name is missing (the resolver requires a player name)', () => {
    expect(src).toMatch(/name is required/)
  })

  it('does NOT persist the resolved URL to the database (Phase 1 non-persistent)', () => {
    // Phase 1 explicitly defers DB write-back — the comment block calls this
    // out so the next phase doesn't accidentally cache stale URLs at this
    // boundary.
    expect(src).not.toMatch(/prisma\..*\.update|prisma\..*\.upsert|prisma\..*\.create/)
    expect(src).toMatch(/non-persistent/)
  })
})
