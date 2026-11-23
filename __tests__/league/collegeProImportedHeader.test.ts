/**
 * Found live 2026-11-23 on Peach Bowl + Cream Bowl and Road To Glory: imported leagues draw their own header
 * (NativeLeagueWorkspace), so the pair chip that only the command-center header carried never showed, and the
 * draft pipeline lived only on a Draft tab an imported league does not have in season.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

describe('one league on imported halves', () => {
  const shell = read('app/league/[leagueId]/LeagueShell.tsx')
  const workspace = read('components/league/native/NativeLeagueWorkspace.tsx')

  it('the imported-league header carries the pair chip', () => {
    expect(shell).toMatch(/headingBadges=\{isCollegeProPairable\(league\.platform\) \? <CollegeProPairChip leagueId=\{league\.id\} variant="native" \/> : null\}/)
    // Drawn inside the header's badge row, after the league's own chips.
    expect(workspace).toMatch(/nativeLeague\.heading\.commissioner'\)\}<\/span>\}\{headingBadges\}<\/div><h1>/)
  })

  it('Draft picks carries the draft pipeline', () => {
    expect(shell).toMatch(/activeTab === 'dynasty_picks' \? oneLeagueDraft\(dynastyHome\) : dynastyHome/)
  })
})
