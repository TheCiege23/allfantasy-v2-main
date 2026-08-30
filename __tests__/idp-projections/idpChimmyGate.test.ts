/**
 * Chimmy's IDP context was gated on a table with zero rows.
 *
 * 🛑 MEASURED IN PRODUCTION 2026-08-30: ten leagues carry `leagueVariant = DYNASTY_IDP`, and
 * `idp_league_configs` holds ZERO rows. `anthropic-pipeline` gated the IDP context builder on
 * `league.idpConfig` alone, so it evaluated false for every one of them and Chimmy received no
 * IDP context, ever. Nothing failed and no test went red: the ternary simply took its empty
 * branch, which is indistinguishable from a league that has no IDP.
 *
 * The config row is an ENRICHMENT, not the source of truth. `isIdpLeague` has always treated
 * the variant as sufficient, and `getIdpLeagueConfig` synthesises defaults for an IDP variant
 * with no stored row — so every layer below the gate already handled this case. Only the gate
 * did not.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\r/g, '')
const PIPELINE = read('lib/agents/anthropic-pipeline.ts')
const CONFIG = read('lib/idp/IDPLeagueConfig.ts')

describe('the Chimmy IDP gate is variant-aware', () => {
  /**
   * 🛑 THE ASSERTION THE OLD GATE FAILED. A source assertion rather than a behavioural one
   * because the gate is a ternary inside a Promise.all in a 1500-line pipeline: a unit test
   * of the BUILDER passes regardless of whether anything calls it, which is exactly how this
   * survived. The edge is the thing under test.
   */
  it('does not gate the IDP context builder on idpConfig alone', () => {
    const call = PIPELINE.slice(
      PIPELINE.indexOf('buildIdpContextForChimmy(ctx.leagueId'),
    )
    // Walk back to the start of the gate expression.
    const gateStart = PIPELINE.lastIndexOf('league.idpConfig', PIPELINE.indexOf('buildIdpContextForChimmy(ctx.leagueId'))
    const gate = PIPELINE.slice(gateStart, gateStart + 200)
    expect(call.length).toBeGreaterThan(0)
    expect(gate).toContain('leagueVariant')
    expect(gate.toLowerCase()).toContain("includes('idp')")
  })

  /**
   * The layers below the gate already handled a missing row; pinning that stops someone
   * "simplifying" the fallback away and silently restoring the dead gate.
   */
  it('getIdpLeagueConfig still synthesises a config for an IDP variant with no row', () => {
    const fn = CONFIG.slice(CONFIG.indexOf('export async function getIdpLeagueConfig'))
    const body = fn.slice(0, fn.indexOf('export async function upsertIdpLeagueConfig'))
    // Returns null only when the variant is not an IDP one...
    expect(body).toContain('IDP_VARIANTS.includes(league.leagueVariant)')
    // ...and otherwise builds a default rather than returning null.
    expect(body).toMatch(/return \{[\s\S]*positionMode: 'standard'[\s\S]*scoringPreset: 'balanced'/)
  })

  /** isIdpLeague must keep its variant fallback, or the builder's own gate goes dead too. */
  it('isIdpLeague falls back to leagueVariant when no config row exists', () => {
    const fn = CONFIG.slice(CONFIG.indexOf('export async function isIdpLeague'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('idpLeagueConfig.findUnique')
    expect(body).toContain('leagueVariant')
    expect(body).toContain('IDP_VARIANTS')
  })

  /**
   * ⚠ The other call site must stay unconditional. app/api/chat/chimmy/route.ts calls the
   * builder with no gate at all and relies on its self-gating; if someone "optimises" that
   * by adding an idpConfig check, it reproduces this bug on the second surface.
   */
  it('the chimmy route calls the builder without an idpConfig gate', () => {
    const route = read('app/api/chat/chimmy/route.ts')
    const idx = route.indexOf('await buildIdpContextForChimmy(')
    expect(idx).toBeGreaterThan(-1)
    const before = route.slice(Math.max(0, idx - 300), idx)
    expect(before).not.toContain('idpConfig')
  })
})
