import { describe, it, expect } from 'vitest'

import {
  resolveCanonicalAssets,
  resolveCanonicalAsset,
  normalizeAssetType,
  fromAfLeagueTradeItems,
  fromRedraftTradeAssets,
  emptyEnrichment,
  emptyContext,
  type CanonicalAsset,
  type RawCanonicalAssetInput,
  type AfLeagueTradeItemRow,
  type RedraftTradeAssetRow,
} from '@/lib/decision-os/world/assets'
import { deriveParticipants, type TradeAssetSummary } from '@/lib/decision-os/trade/dco'

/**
 * Phase E.1 — Canonical Asset Resolution (ADR-DOS-003 §3/§7).
 *
 * Proves the reusable, origin-blind `CanonicalAsset` contract and its Resolution layer:
 *   (1) PARITY — the SAME logical trade resolves identically whether it arrives via the canonical asset
 *       graph (`AfLeagueTradeItem`) or the redraft graph (`RedraftTradeAsset`), down to an identical
 *       `deriveParticipants` graph (the trade layer *consumes* the asset; it does not define it).
 *   (2) HONESTY — enrichment, context, and value are present-but-honestly-EMPTY at E.1 (every field null,
 *       flagged in `completeness.layers`); nothing is fabricated; the one genuinely-missing fact (pick
 *       ownership inventory, §5) is surfaced as uncertainty, not invented.
 *   (3) COVERAGE — every asset class in the contract resolves into the correct metadata slot.
 *
 * Pure + hermetic: plain row objects, no prisma, no IO.
 */

// A single logical two-team trade, expressed in BOTH source graphs:
//   rA → rB : Josh Allen (player) + $15 FAAB
//   rB → rA : Christian McCaffrey (player) + a 2026 R2 pick (originally rC's)
const AF_ITEMS: AfLeagueTradeItemRow[] = [
  { id: 'i1', itemType: 'player', itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: { playerName: 'Josh Allen', position: 'QB', team: 'BUF' } },
  { id: 'i2', itemType: 'player', itemReference: 'p2', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: { playerName: 'Christian McCaffrey', position: 'RB', team: 'SF' } },
  // NOTE: canonical graph uses the 'pick' token; redraft uses 'draft_pick' — both must normalize equally.
  { id: 'i3', itemType: 'pick', itemReference: '2026 R2', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: { pickSeason: 2026, pickRound: 2, originalRosterId: 'rC' } },
  { id: 'i4', itemType: 'faab', itemReference: null, fromRosterId: 'rA', toRosterId: 'rB', faabAmount: 15, metadata: {} },
]

const REDRAFT_ASSETS: RedraftTradeAssetRow[] = [
  { id: 'i1', assetType: 'player', fromRosterId: 'rA', toRosterId: 'rB', playerId: 'p1', playerName: 'Josh Allen', pickSeason: null, pickRound: null, pickNumber: null, metadata: { position: 'QB', team: 'BUF' } },
  { id: 'i2', assetType: 'player', fromRosterId: 'rB', toRosterId: 'rA', playerId: 'p2', playerName: 'Christian McCaffrey', pickSeason: null, pickRound: null, pickNumber: null, metadata: { position: 'RB', team: 'SF' } },
  { id: 'i3', assetType: 'draft_pick', fromRosterId: 'rB', toRosterId: 'rA', playerId: null, playerName: null, pickSeason: 2026, pickRound: 2, pickNumber: null, metadata: { originalRosterId: 'rC' } },
  { id: 'i4', assetType: 'faab', fromRosterId: 'rA', toRosterId: 'rB', playerId: null, playerName: null, pickSeason: null, pickRound: null, pickNumber: null, metadata: { faabAmount: 15 } },
]

/**
 * Build trade summaries the trade layer would consume. The asset carries only its current `owner`;
 * exchange direction (`toRosterId`) is supplied by the consumer from the staging input — demonstrating
 * that Trade ADDS direction to a reusable asset rather than the asset owning trade semantics.
 */
function toSummaries(inputs: RawCanonicalAssetInput[], assets: CanonicalAsset[]): TradeAssetSummary[] {
  return assets.map((asset, i) => ({
    fromRosterId: asset.owner.rosterId ?? '',
    toRosterId: inputs[i].toRosterId,
    assetType: asset.assetType,
    playerId: asset.metadata.player?.playerId ?? asset.metadata.keeper?.playerId ?? asset.metadata.devy?.playerId ?? null,
    playerName: asset.metadata.player?.name ?? null,
    faabAmount: asset.metadata.faab?.amount ?? null,
  }))
}

describe('Phase E.1 — Canonical Asset Resolution: redraft ↔ canonical parity', () => {
  const afInputs = fromAfLeagueTradeItems(AF_ITEMS, 'native')
  const redraftInputs = fromRedraftTradeAssets(REDRAFT_ASSETS)
  const afAssets = resolveCanonicalAssets(afInputs)
  const redraftAssets = resolveCanonicalAssets(redraftInputs)

  it('resolves the same asset count and assetType sequence from either source', () => {
    const expected = ['player', 'player', 'draft_pick', 'faab']
    expect(afAssets.map((a) => a.assetType)).toEqual(expected)
    expect(redraftAssets.map((a) => a.assetType)).toEqual(expected)
  })

  it('produces an IDENTICAL deriveParticipants graph from either source (trade consumes the asset)', () => {
    const af = deriveParticipants(toSummaries(afInputs, afAssets))
    const redraft = deriveParticipants(toSummaries(redraftInputs, redraftAssets))
    expect(af).toEqual(redraft)
    // Sanity: it is genuinely a two-team trade with both rosters sending and receiving.
    expect(af.map((p) => p.rosterId).sort()).toEqual(['rA', 'rB'])
    for (const p of af) {
      expect(p.sends.length).toBeGreaterThan(0)
      expect(p.receives.length).toBeGreaterThan(0)
    }
  })

  it('resolves identical owner + identity metadata regardless of source', () => {
    for (let i = 0; i < afAssets.length; i++) {
      expect(afAssets[i].owner).toEqual(redraftAssets[i].owner)
      expect(afAssets[i].metadata).toEqual(redraftAssets[i].metadata)
    }
    // Owner is the CURRENT holder (the sender), never fabricated.
    expect(afAssets[0].owner.rosterId).toBe('rA')
    expect(afAssets[1].owner.rosterId).toBe('rB')
  })

  it('preserves FAAB dollars and player identity across both adapters', () => {
    expect(afAssets[3].metadata.faab?.amount).toBe(15)
    expect(redraftAssets[3].metadata.faab?.amount).toBe(15)
    expect(afAssets[0].metadata.player).toEqual({ playerId: 'p1', name: 'Josh Allen', position: 'QB', team: 'BUF' })
    expect(redraftAssets[0].metadata.player).toEqual({ playerId: 'p1', name: 'Josh Allen', position: 'QB', team: 'BUF' })
  })

  it('resolves the pick from either token (pick / draft_pick) with the same metadata', () => {
    expect(afAssets[2].assetType).toBe('draft_pick')
    expect(redraftAssets[2].assetType).toBe('draft_pick')
    expect(afAssets[2].metadata.pick?.season).toBe(2026)
    expect(afAssets[2].metadata.pick?.round).toBe(2)
    expect(afAssets[2].metadata.pick?.originalRosterId).toBe('rC')
    expect(redraftAssets[2].metadata.pick?.originalRosterId).toBe('rC')
  })
})

describe('Phase E.1 — honest-empty layers (Resolution only)', () => {
  const assets = resolveCanonicalAssets(fromAfLeagueTradeItems(AF_ITEMS))

  it('fills ONLY the resolution layer; enrichment/context/value are present-but-empty', () => {
    for (const a of assets) {
      // value is not computed at E.1 — honestly null, never a fabricated number.
      expect(a.value).toBeNull()
      // every enrichment + context field honestly null.
      expect(Object.values(a.enrichment).every((v) => v === null)).toBe(true)
      expect(Object.values(a.context).every((v) => v === null)).toBe(true)
      // completeness reflects which layers actually exist.
      expect(a.completeness.layers).toEqual({ resolution: true, enrichment: false, context: false, value: false })
      expect(a.completeness.score).toBeGreaterThanOrEqual(0)
      expect(a.completeness.score).toBeLessThanOrEqual(100)
    }
  })

  it('the empty layer factories produce all-null shapes', () => {
    expect(Object.values(emptyEnrichment()).every((v) => v === null)).toBe(true)
    expect(Object.values(emptyContext()).every((v) => v === null)).toBe(true)
  })

  it('surfaces the missing pick-ownership inventory as uncertainty (§5), not a fabricated fact', () => {
    const pick = assets.find((a) => a.assetType === 'draft_pick')!
    expect(pick.uncertainty.some((u) => u.toLowerCase().includes('pick ownership'))).toBe(true)
    // Non-pick assets do not carry the pick-ownership caveat.
    expect(assets[0].uncertainty.some((u) => u.toLowerCase().includes('pick ownership'))).toBe(false)
  })

  it('records provenance (origin lives here, never in decision-facing metadata)', () => {
    expect(assets[0].provenance.sourceModel).toBe('AfLeagueTradeItem')
    expect(assets[0].provenance.trust).toBe('high')
  })
})

describe('Phase E.1 — type normalization', () => {
  it('maps known synonyms to canonical types', () => {
    expect(normalizeAssetType('pick')).toEqual({ type: 'draft_pick', recognized: true })
    expect(normalizeAssetType('Draft Pick')).toEqual({ type: 'draft_pick', recognized: true })
    expect(normalizeAssetType('FAAB')).toEqual({ type: 'faab', recognized: true })
    expect(normalizeAssetType('devy')).toEqual({ type: 'devy', recognized: true })
  })

  it('falls back to future_consideration + unverified for an unknown token (honest, not a guess)', () => {
    const { type, recognized } = normalizeAssetType('mystery_asset')
    expect(type).toBe('future_consideration')
    expect(recognized).toBe(false)

    const asset = resolveCanonicalAsset({
      id: 'x1',
      rawType: 'mystery_asset',
      fromRosterId: 'rA',
      toRosterId: 'rB',
      playerId: null,
      playerName: null,
      position: null,
      team: null,
      pickSeason: null,
      pickRound: null,
      pickNumber: null,
      pickOriginalRosterId: null,
      pickLabel: null,
      faabAmount: null,
      origin: null,
      sourceModel: 'AfLeagueTradeItem',
    })
    expect(asset.assetType).toBe('future_consideration')
    expect(asset.provenance.trust).toBe('unverified')
    expect(asset.uncertainty.some((u) => u.includes('Unrecognized asset type'))).toBe(true)
  })
})

describe('Phase E.1 — full asset-class coverage', () => {
  const base = {
    fromRosterId: 'rA',
    toRosterId: 'rB',
    playerId: 'pl',
    playerName: 'Some Player',
    position: 'WR',
    team: 'KC',
    pickSeason: 2027,
    pickRound: 1,
    pickNumber: 5,
    pickOriginalRosterId: 'rA',
    pickLabel: '2027 R1',
    faabAmount: 40,
    origin: null,
    sourceModel: 'AfLeagueTradeItem',
  }
  const make = (id: string, rawType: string): RawCanonicalAssetInput => ({ id, rawType, ...base })

  it('routes each asset class into the correct metadata slot', () => {
    const player = resolveCanonicalAsset(make('a', 'player'))
    expect(player.metadata.player?.playerId).toBe('pl')

    const pick = resolveCanonicalAsset(make('b', 'draft_pick'))
    expect(pick.metadata.pick?.season).toBe(2027)

    const faab = resolveCanonicalAsset(make('c', 'faab'))
    expect(faab.metadata.faab?.amount).toBe(40)

    const keeper = resolveCanonicalAsset(make('d', 'keeper'))
    expect(keeper.metadata.keeper?.playerId).toBe('pl')
    expect(keeper.metadata.keeper?.keeperCost).toBeNull() // modeled-but-unvalued until Phase F

    const devy = resolveCanonicalAsset(make('e', 'devy'))
    expect(devy.metadata.devy?.playerId).toBe('pl')

    const salary = resolveCanonicalAsset(make('f', 'salary'))
    expect(salary.metadata.salary?.amount).toBe(40)

    const contract = resolveCanonicalAsset(make('g', 'contract'))
    expect(contract.metadata.contract).toEqual({ years: null, capHit: null })

    const future = resolveCanonicalAsset(make('h', 'future_consideration'))
    // future considerations carry no identity slot — every metadata slot stays null.
    expect(Object.values(future.metadata).every((v) => v === null)).toBe(true)
  })
})
