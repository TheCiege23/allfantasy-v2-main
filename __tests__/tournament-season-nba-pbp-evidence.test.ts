import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { inspectSeasonRiNbaFoulPlays, reconcileSeasonRiNbaFoulSnapshots } from '@/lib/tournament/seasonNbaPbpEvidence'

const fixture = JSON.parse(readFileSync('contracts/rolling-insights/fixtures/play-by-play.NBA.json', 'utf8'))
const gameId = fixture.data.NBA[0].game_ID

it('reports the measured team technical foul as unattributed instead of charging a player', () => {
  const report = inspectSeasonRiNbaFoulPlays(fixture, gameId)
  expect(report.playCount).toBe(437)
  expect(report.unattributed).toEqual([{ sequence: 220, action: 'technical_foul_committed', reason: 'No single provider-ID fouler is proven.' }])
  expect(report.attributed).toEqual({})
})

it('counts only a single matching player fouler, excluding reversed and ambiguous events', () => {
  const payload = { data: { NBA: [{ game_ID: 'g', plays: [
    { sequence: 1, action: 'technical_foul_committed', players: [{ id: '123', role: 'fouler', action: 'technical_foul_committed' }] },
    { sequence: 2, action: 'flagrant_foul_committed', players: [{ id: 123, role: 'fouler', action: 'flagrant_foul_committed' }] },
    { sequence: 3, action: 'flagrant_foul_committed', players: [{ id: 123, role: 'fouler', action: 'flagrant_foul_committed' }], details: { noPlay: true } },
    { sequence: 4, action: 'technical_foul_committed', players: [{ id: '123', role: 'fouled', action: 'technical_foul_committed' }] },
  ] }] } }
  expect(inspectSeasonRiNbaFoulPlays(payload, 'g')).toMatchObject({ attributed: { '123': { technical_foul: 1, flagrant_foul: 1 } }, reversed: [3], unattributed: [{ sequence: 4 }] })
  expect(() => inspectSeasonRiNbaFoulPlays(payload, 'different')).toThrow()
  payload.data.NBA[0].plays.push({ sequence: 1, action: 'technical_foul_committed', players: [] })
  expect(() => inspectSeasonRiNbaFoulPlays(payload, 'g')).toThrow('Duplicate NBA play-by-play sequence.')
})

it('reconciles full sparse-sequence snapshots and sends changed or backfilled plays to review', () => {
  const make = (plays: unknown[]) => ({ data: { NBA: [{ game_ID: 'g', plays }] } })
  const technical = { sequence: 2, action: 'technical_foul_committed', players: [{ id: '123', role: 'fouler', action: 'technical_foul_committed' }] }
  const ordinary = { sequence: 8, action: 'make_2pt', players: [] }
  const initial = make([technical, ordinary])
  const reorder = reconcileSeasonRiNbaFoulSnapshots(initial, make([ordinary, technical]), 'g')
  expect(reorder).toMatchObject({ status: 'unchanged', added: [], removed: [], changed: [], backfilled: [] })
  expect(reorder.currentDigest).toBe(reorder.previousDigest)

  const newFoul = { sequence: 15, action: 'flagrant_foul_committed', players: [{ id: '123', role: 'fouler', action: 'flagrant_foul_committed' }] }
  expect(reconcileSeasonRiNbaFoulSnapshots(initial, make([technical, ordinary, newFoul]), 'g')).toMatchObject({ status: 'appended', added: [15], currentFouls: { attributed: { '123': { technical_foul: 1, flagrant_foul: 1 } } } })
  const corrected = { ...technical, players: [{ id: '456', role: 'fouler', action: 'technical_foul_committed' }] }
  const revision = reconcileSeasonRiNbaFoulSnapshots(initial, make([corrected, ordinary]), 'g')
  expect(revision).toMatchObject({ status: 'review_required', changed: [2], previousFouls: { attributed: { '123': { technical_foul: 1 } } }, currentFouls: { attributed: { '456': { technical_foul: 1 } } } })
  expect(revision.currentDigest).not.toBe(revision.previousDigest)
  expect(reconcileSeasonRiNbaFoulSnapshots(initial, make([{ ...technical, isReversed: true }, ordinary]), 'g')).toMatchObject({ status: 'review_required', changed: [2], currentFouls: { attributed: {}, reversed: [2] } })
  expect(reconcileSeasonRiNbaFoulSnapshots(initial, make([ordinary]), 'g')).toMatchObject({ status: 'review_required', removed: [2] })
  expect(reconcileSeasonRiNbaFoulSnapshots(initial, make([technical, ordinary, { sequence: 5, action: 'make_ft', players: [] }]), 'g')).toMatchObject({ status: 'review_required', added: [5], backfilled: [5] })
})

it('does not infer a correction from provider play ordering alone', () => {
  const shuffled = structuredClone(fixture)
  shuffled.data.NBA[0].plays.reverse()
  expect(reconcileSeasonRiNbaFoulSnapshots(fixture, shuffled, gameId)).toMatchObject({ status: 'unchanged', added: [], removed: [], changed: [] })
})
