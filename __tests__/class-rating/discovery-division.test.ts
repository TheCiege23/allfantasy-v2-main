// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('uses the Career Level decision to render a request link instead of hiding out-of-band fantasy leagues', () => {
  const service = readFileSync('lib/public-discovery/PublicDiscoveryService.ts', 'utf8')
  const card = readFileSync('components/discovery/FindLeagueCard.tsx', 'utf8')
  expect(service).toContain('decideCareerJoin(viewerLevel, level, approved)')
  expect(service).toContain('requiresCareerApproval: !canJoin')
  expect(card.indexOf('league.requiresCareerApproval')).toBeLessThan(card.indexOf('find-league-join-'))
  expect(card).toContain('Request to join')
})
