/**
 * Standings and My League fit a tablet (2026-11-09, tournament gaps audit item 3). #3458 moved the tables' 560px
 * minimum to `sm` so a phone sees W-L and PF. But from `md` the tournament sidebar takes 220px, so between ~768 and
 * ~1000px the content area is 498–760px and a 560px table scrolled sideways inside its panel with no cue, cutting
 * points-for mid-number ("710.4" read "71"): 78px hidden at 768, 26px at 820. The minimum now starts at `lg`
 * (1024px, ~756px of content), where it fits. Measured after: no hidden table width and no page overflow on every
 * Standings tab and My League at 640, 700, 768, 820, 900, 1000, 1024 and 1100.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(rel, 'utf8')

describe.each(['app/tournament/[tournamentId]/standings/page.tsx', 'app/tournament/[tournamentId]/league/page.tsx'])(
  '%s',
  (rel) => {
    const tables = [...read(rel).matchAll(/<table className="([^"]+)"/g)].map((m) => m[1]!.split(/\s+/))

    it('has tables to check', () => {
      expect(tables.length).toBeGreaterThan(0)
    })

    it('sets no table minimum width below lg (the sidebar leaves too little room at sm and md)', () => {
      for (const classes of tables) {
        expect(classes.filter((c) => /^(sm:|md:)?min-w-/.test(c)), classes.join(' ')).toEqual([])
      }
    })

    it('still sets the 560px minimum from lg, where it fits', () => {
      for (const classes of tables) expect(classes, classes.join(' ')).toContain('lg:min-w-[560px]')
    })
  },
)
