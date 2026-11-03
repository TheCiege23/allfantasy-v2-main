/**
 * 🛑 "Open in Fantrax" in the league header opens the LEAGUE, not the Fantrax homepage.
 *
 * For a Fantrax league `League.platformLeagueId` is AllFantasy's own snapshot uuid (`FantraxLeague.id`);
 * Fantrax's real league id is that snapshot's `sourceLeagueId`, looked up by `fantraxSourceLeagueIds` /
 * `linkableSourceLeagueId`. The league page handed the header (`LeagueWorkspaceNavigation`) the raw
 * uuid, so `resolveSourceLink` could not build a league URL and fell back to the homepage.
 *
 * The page is a server component and the shell a 700-line client component, so — as
 * league-page-resilience.test.tsx does — the wiring is read from source (comments stripped), and the
 * id mapping itself is exercised for real.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantraxLeague: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [{ id: 'snap-uuid', sourceLeagueId: 'abc123fantrax' }, { id: 'csv-uuid', sourceLeagueId: null }].filter((r) => where.id.in.includes(r.id)),
      ),
    },
  },
}))

import { fantraxSourceLeagueIds, linkableSourceLeagueId } from '@/lib/league-links/resolveSourceLinkForLeague'
import { resolveSourceLink } from '@/lib/league-links/sourceLinkResolver'

const code = (rel: string) =>
  readFileSync(resolve(__dirname, '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('league header source link', () => {
  it('the page resolves the linkable id server-side and hands it to the shell', () => {
    const page = code('app/league/[leagueId]/page.tsx')
    expect(page).toMatch(/linkableSourceLeagueId\(\s*league\s*,\s*await fantraxSourceLeagueIds\(\[\s*league\s*\]\)\s*\)/)
    expect(page).toMatch(/sourceLinkLeagueId=\{sourceLinkLeagueId\}/)
  })

  it('the shell builds the header link from that id, not from the raw snapshot uuid', () => {
    const shell = code('app/league/[leagueId]/LeagueShell.tsx')
    const nav = shell.match(/<LeagueWorkspaceNavigation[\s\S]*?\/>/)?.[0] ?? ''
    expect(nav).toContain('sourceLeagueId=')
    expect(nav).not.toMatch(/sourceLeagueId=\{league\.platformLeagueId\}/)
    expect(nav).toMatch(/sourceLinkLeagueId/)
  })

  it('maps a Fantrax snapshot to its real league id; other platforms and CSV rows behave as before', async () => {
    const rows = [
      { platform: 'fantrax', platformLeagueId: 'snap-uuid' },
      { platform: 'fantrax', platformLeagueId: 'csv-uuid' },
      { platform: 'sleeper', platformLeagueId: '998877' },
    ]
    const ids = await fantraxSourceLeagueIds(rows)
    expect(linkableSourceLeagueId(rows[0], ids)).toBe('abc123fantrax')
    expect(linkableSourceLeagueId(rows[1], ids)).toBeNull()
    expect(linkableSourceLeagueId(rows[2], ids)).toBe('998877')
    const link = resolveSourceLink({ platform: 'fantrax', sourceLeagueId: 'abc123fantrax', leagueName: 'X', season: 2026 })
    expect(link).toMatchObject({ destinationType: 'league' })
    expect(link?.href).toContain('abc123fantrax')
    /* The bug: the raw snapshot uuid only reaches the homepage. */
    const raw = resolveSourceLink({ platform: 'fantrax', sourceLeagueId: 'snap-uuid', leagueName: 'X', season: 2026 })
    expect(raw?.destinationType).toBe('homepage')
  })
})
