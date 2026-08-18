import Link from 'next/link'

/**
 * The six-tile tool grid from the handoff.
 *
 * ⚠ EVERY SUBLINE IS A READ, NOT A CAPTION. The handoff draws "across all 7
 * leagues", "3 leagues you own" and "your tier and shield" — numbers, which is
 * the whole point of putting them under the tile. They come from the same values
 * the rest of this screen renders (`totalLeagues`, `commissionerCount`, the
 * career level), so a tile cannot claim a different portfolio size than the
 * league panel two columns to its left.
 *
 * ⚠ A SUBLINE IS OMITTED RATHER THAN DEFAULTED. "0 leagues you own" and "across
 * all 0 leagues" both read as measured facts about an account that simply has
 * not imported anything yet, and "your tier and shield" is a promise on an
 * account with no career rows behind it. When the number is absent the tile
 * still links — it just stops describing something it cannot see.
 *
 * ⚠ EVERY HREF IS A KEY IN SCREEN_KEYS. `/core/<segment>` resolves through the
 * catch-all; an unknown segment silently falls back to the dashboard, so a
 * mistyped tile here would look like a dead button rather than a 404. These six
 * are `players`, `trades`, `waivers`, `rankings`, `career` and `commissioner`.
 */

type Tile = {
  href: string
  glyph: string
  title: string
  sub: string | null
}

export function ToolsGrid({
  totalLeagues = 0,
  commissionerCount = 0,
  levelName = null,
  hasCareer = false,
}: {
  totalLeagues?: number
  commissionerCount?: number
  levelName?: string | null
  hasCareer?: boolean
}) {
  const leaguePhrase =
    totalLeagues > 0
      ? `across all ${totalLeagues} ${totalLeagues === 1 ? 'league' : 'leagues'}`
      : null

  const tiles: Tile[] = [
    { href: '/core/players', glyph: '◎', title: 'Player finder', sub: leaguePhrase },
    { href: '/core/trades', glyph: '⇄', title: 'Trade lab', sub: 'grades per league scoring' },
    {
      href: '/core/waivers',
      glyph: '◆',
      title: 'Waiver plan',
      sub: totalLeagues > 0 ? 'one run, every league' : null,
    },
    {
      href: '/core/rankings',
      glyph: '▲',
      title: 'Rankings',
      // The handoff's "your tier and shield" only means something once a tier exists.
      sub: levelName ? `your tier · ${levelName}` : null,
    },
    {
      href: '/core/career',
      glyph: '★',
      title: 'Career & Legacy',
      sub: hasCareer ? 'rings, arc, badge case' : null,
    },
    {
      href: '/core/commissioner',
      glyph: '▤',
      title: 'Commissioner HQ',
      sub:
        commissionerCount > 0
          ? `${commissionerCount} ${commissionerCount === 1 ? 'league' : 'leagues'} you own`
          : null,
    },
  ]

  return (
    <div className="af-d2-tools">
      {tiles.map((tile) => (
        <Link key={tile.href} href={tile.href} className="af-d2-tool">
          <span className="af-d2-tool-glyph" aria-hidden>
            {tile.glyph}
          </span>
          <span className="af-d2-tool-text">
            <span className="af-d2-tool-title">{tile.title}</span>
            {tile.sub ? <span className="af-d2-tool-sub">{tile.sub}</span> : null}
          </span>
        </Link>
      ))}
    </div>
  )
}

export default ToolsGrid
