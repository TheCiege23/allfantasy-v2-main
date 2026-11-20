/**
 * A league played as Zombie on another platform says there is no outbreak board, instead of opening on
 * a red "Not a zombie league" (lib/zombie/importedZombieNote.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importedZombieNote } from '@/lib/zombie/importedZombieNote'

describe('importedZombieNote', () => {
  it('an imported league typed zombie gets the note, naming the platform', () => {
    expect(importedZombieNote({ platform: 'sleeper', leagueType: 'zombie', leagueVariant: '' })).toBe(
      'This league is played as Zombie on Sleeper, where the commissioner tracks the Whisperer and the infections by hand. AllFantasy has its scores, rosters and standings, but not who is a zombie or a survivor, so there is no outbreak board to show here.',
    )
    expect(importedZombieNote({ platform: 'some-new-site', leagueType: null, leagueVariant: 'zombie' })).toContain('on another platform')
  })

  it('a league AllFantasy hosts never gets it: a missing board there is a real fault', () => {
    expect(importedZombieNote({ platform: 'manual', leagueType: 'zombie', leagueVariant: 'zombie' })).toBeNull()
  })

  it('an imported league that is not zombie does not get it', () => {
    expect(importedZombieNote({ platform: 'sleeper', leagueType: 'redraft', leagueVariant: '' })).toBeNull()
    expect(importedZombieNote(null)).toBeNull()
  })
})

describe('where it is used', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the summary route answers with the note before its 404', () => {
    const route = read('app/api/leagues/[leagueId]/zombie/summary/route.ts')
    const note = route.indexOf('if (imported) return NextResponse.json({ importedNote: imported })')
    expect(note).toBeGreaterThan(0)
    expect(note).toBeLessThan(route.indexOf("return NextResponse.json({ error: 'Not a zombie league' }, { status: 404 })"))
  })
  it('the Zombie home shows the note, not the error box', () => {
    const home = read('components/zombie/ZombieHome.tsx')
    expect(home.indexOf('data-testid="zombie-imported-note"')).toBeGreaterThan(0)
    expect(home.indexOf('if (importedNote && !summary) {')).toBeLessThan(home.indexOf('if (error && !summary) {'))
  })
  it('an imported league is not sent to the Zombie tab on open', () => {
    const shell = read('app/league/[leagueId]/LeagueShell.tsx')
    expect(shell).toMatch(/^\s*if \(!zombieLeague \|\| zombieLandingApplied\.current\) return\n(?:\s*\/\/.*\n)*\s*if \(!nativeWorkspace\) return$/m)
  })
})
