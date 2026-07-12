import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('G58 invited MVP release guardrails', () => {
  it('loads shared declaration files in the real TypeScript project', () => {
    const tsconfig = JSON.parse(read('tsconfig.json')) as { include?: string[] }
    expect(tsconfig.include).toContain('types/**/*.d.ts')
    expect(read('types/next-auth.d.ts')).toContain('spotifyAccount?: boolean')
    expect(read('types/next-auth.d.ts')).toContain('username?: string | null')
    expect(read('types/web-push.d.ts')).toContain("declare module 'web-push'")
  })

  it('reconciles optimistic lineup state after a failed authoritative save', () => {
    const roster = read('components/app/roster/useRosterManager.ts')
    expect(roster).toContain('if (saving) return false')
    expect(roster).toContain('await loadRoster()')
    expect(roster).toContain('The last confirmed roster has been restored')
    expect(roster).not.toContain('catch (err: any)')
  })

  it('keeps standings authoritative and discloses pending stat corrections', () => {
    const standings = read('app/league/[leagueId]/tabs/redraft/StandingsView.tsx')
    expect(standings).toContain('Rankings and playoff seeds come from the league standings service')
    expect(standings).toContain('pending stat corrections may change the order')
    expect(standings).toContain('min-w-[680px]')
  })

  it('prevents provider and prohibited terminology leakage in hardened market copy', () => {
    const players = read('app/league/[leagueId]/tabs/PlayersTab.tsx')
    const claim = read('components/waiver-wire/WaiverClaimDrawer.tsx')
    const waivers = read('components/waiver-wire/WaiverWirePage.tsx')
    const customerCopy = `${players}\n${claim}\n${waivers}`

    expect(players).not.toContain('Rolling Insights</span>')
    expect(claim).not.toContain('AI suggestions are advisory')
    expect(waivers).not.toContain('Waiver AI Engine')
    expect(waivers).not.toContain('Get AI waiver help')
    expect(customerCopy).toContain('Decision Support')
  })

  it('freezes NFL and NCAAF scope without promoting runtime-only evidence', () => {
    const matrix = read('docs/redraft/NFL_NCAAF_INVITED_MVP_FEATURE_MATRIX.md')
    expect(matrix).toContain('## NFL Redraft')
    expect(matrix).toContain('## NCAAF Redraft')
    expect(matrix).toContain('| Auction draft | Deferred |')
    expect(matrix).toContain('| Sleeper import | Hidden |')
    expect(matrix).toContain('Requires certification')
  })
})
