import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildLeagueRulesGrounding } from '@/lib/chimmy/leagueRulesGrounding'
import { getConceptById, listConcepts, resolveLeagueRules } from '@/lib/league-rules'
import { LEAGUE_COLUMN_DEFAULTS } from '@/lib/league-rules/resolveLeagueRules'

/**
 * These map one-to-one onto the brief's minimum acceptance scenarios. Each is
 * written so that deleting the behaviour it guards turns it red — the repo's
 * own rule that an assertion never seen failing is not yet evidence.
 */

/** A league row shaped the way `normalizeConcept` actually stores an alias. */
function leagueWithAlias(base: string, tags: string[], extra: Record<string, unknown> = {}) {
  return {
    leagueType: base,
    settings: { conceptRules: { extensions: { aliasTags: tags } } },
    ...extra,
  }
}

describe('concept catalog integrity', () => {
  it('has no duplicate ids', () => {
    const ids = listConcepts().map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never maps two catalog entries to the same classifier concept', () => {
    /*
     * A duplicate here would make `getConceptForFormat` return whichever entry
     * happened to be declared first — an ordering accident deciding which rules
     * a league is told it plays under.
     */
    const claimed = listConcepts()
      .map((c) => c.formatRulesConcept)
      .filter((c): c is NonNullable<typeof c> => c !== null)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('gives every entry a rule version and a runtime authority to check it against', () => {
    for (const c of listConcepts()) {
      expect(c.ruleVersion, `${c.id} rule version`).toMatch(/^\d+\.\d+\.\d+$/)
      expect(c.runtimeAuthority.length, `${c.id} runtime authority`).toBeGreaterThan(0)
    }
  })
})

describe('King of the Hill retains its concept when its base format is redraft', () => {
  const league = leagueWithAlias('redraft', ['king_of_the_hill'])

  it('resolves to King of the Hill, not redraft', () => {
    const resolved = resolveLeagueRules(league)
    expect(resolved.concept?.id).toBe('king_of_the_hill')
  })

  it('still reports the redraft shell it was flattened onto', () => {
    // Both names, because dropping either one is a different wrong answer.
    expect(resolveLeagueRules(league).flattenedOnto).toBe('redraft')
  })

  it('says both in the prompt', () => {
    const text = buildLeagueRulesGrounding(league) ?? ''
    expect(text).toContain('King of the Hill')
    expect(text).toContain('redraft shell')
  })
})

describe('IDP does not erase dynasty', () => {
  /*
   * The measurement in leagueFormatRules.ts: 183 of 271 production leagues
   * carry ['idp'], and treating it as a format demotes 97 dynasty leagues to
   * redraft. This is that case.
   */
  const league = leagueWithAlias('dynasty', ['idp'], { isDynasty: true })

  it('keeps the format as dynasty', () => {
    expect(resolveLeagueRules(league).concept?.id).toBe('dynasty')
  })

  it('reports IDP as a modifier alongside the format, not instead of it', () => {
    const resolved = resolveLeagueRules(league)
    expect(resolved.modifiers.map((m) => m.id)).toEqual(['idp'])
    expect(resolved.concept?.id).not.toBe('idp')
  })

  it('tells the model the modifier does not replace the format', () => {
    const text = buildLeagueRulesGrounding(league) ?? ''
    expect(text).toContain('do not replace it')
    expect(text).toContain('Dynasty')
  })

  it('keeps dynasty even when idp is listed FIRST', () => {
    /*
     * `alias[0]` was the original bug and array order is an accident of how the
     * league was created. Both orders must give the same answer.
     */
    const idpFirst = leagueWithAlias('dynasty', ['idp', 'king_of_the_hill'], { isDynasty: true })
    const kothFirst = leagueWithAlias('dynasty', ['king_of_the_hill', 'idp'], { isDynasty: true })
    expect(resolveLeagueRules(idpFirst).concept?.id).toBe(resolveLeagueRules(kothFirst).concept?.id)
  })
})

describe('the mirrored column defaults still match prisma/schema.prisma', () => {
  /*
   * `LEAGUE_COLUMN_DEFAULTS` is a hand-copy of the schema, and a hand-copy
   * drifts. If it drifts the resolver starts reporting a real default as a
   * commissioner's setting again, silently — so the drift is checked, not
   * trusted.
   */
  const schema = readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  const leagueModel = schema.slice(schema.indexOf('model League {'))
  const modelBody = leagueModel.slice(0, leagueModel.indexOf('\n}'))

  function declaredDefault(column: string): string | null {
    const line = modelBody
      .split('\n')
      .find((l) => new RegExp(`^\\s+${column}\\s`).test(l))
    if (!line) return null
    const m = line.match(/@default\(([^)]*)\)/)
    return m ? m[1].replace(/^"|"$/g, '') : null
  }

  it('finds the League model (positive control — a bad slice must not read as agreement)', () => {
    // Without this, a failed indexOf would make every check below vacuously pass.
    expect(modelBody).toContain('keeperCount')
    expect(declaredDefault('keeperCount')).not.toBeNull()
  })

  it('agrees with the schema on every mirrored column', () => {
    expect(declaredDefault('keeperCount')).toBe(String(LEAGUE_COLUMN_DEFAULTS.keeperCount))
    expect(declaredDefault('keeperCostSystem')).toBe(LEAGUE_COLUMN_DEFAULTS.keeperCostSystem)
    expect(declaredDefault('keeperRoundPenalty')).toBe(String(LEAGUE_COLUMN_DEFAULTS.keeperRoundPenalty))
  })
})

describe('a schema default is never reported as a commissioner setting', () => {
  /*
   * 🛑 THE ROW ALWAYS HAS A VALUE. `League` declares keeperCount @default(3) and
   * keeperCostSystem @default("round_based"), so a redraft league that nobody
   * configured still arrives carrying a full keeper policy. Reporting that as a
   * league setting invents a rule for essentially every league in the database.
   */
  const untouchedRow = {
    leagueType: 'redraft',
    keeperCount: LEAGUE_COLUMN_DEFAULTS.keeperCount,
    keeperCostSystem: LEAGUE_COLUMN_DEFAULTS.keeperCostSystem,
    keeperRoundPenalty: LEAGUE_COLUMN_DEFAULTS.keeperRoundPenalty,
  }

  it('marks an untouched keeper column as a schema default, not a league setting', () => {
    const resolved = resolveLeagueRules(untouchedRow)
    expect(resolved.keeper.costSystem.provenance).toBe('schema_default')
    expect(resolved.keeper.maxKeepers.provenance).toBe('schema_default')
  })

  it('does not staple a keeper block onto a redraft league with no keepers', () => {
    const text = buildLeagueRulesGrounding({ ...untouchedRow, keeperCount: 0 }) ?? ''
    expect(text).not.toContain('Keeper / pick rules')
  })

  it('an untouched redraft row is NOT reclassified as keeper by the column default', () => {
    /*
     * ⚠ THIS ASSERTION WAS INVERTED ON 2026-09-09, AND THE INVERSION IS THE
     * RECORD. It previously pinned the exposure — asserting `keeper`, with a
     * comment saying it SHOULD go red once the decision was made. The user
     * ruled: an untouched `keeperCount = 3` means unconfirmed, not three
     * keepers. The fix went into `readFormatRules` (the classifier both pricing
     * paths already select on), this test went red on the same run, and it now
     * asserts the decided behaviour. Full coverage of the rule lives in
     * `__tests__/league-rules/keeperClassification.test.ts`.
     */
    expect(resolveLeagueRules(untouchedRow).formatRules.concept).toBe('redraft')
    expect(resolveLeagueRules(untouchedRow).keeperEvidence).toBeNull()
  })

  it('still recognises a value the commissioner actually changed', () => {
    const resolved = resolveLeagueRules({ ...untouchedRow, keeperCostSystem: 'auction_pct' })
    expect(resolved.keeper.costSystem.provenance).toBe('league_setting')
    expect(resolved.keeper.costSystem.value).toBe('auction_pct')
  })

  it('prints the default as unconfirmed in a keeper league rather than hiding it', () => {
    const text = buildLeagueRulesGrounding({ ...untouchedRow, leagueType: 'keeper' }) ?? ''
    expect(text).toContain('UNCONFIRMED DEFAULT')
    expect(text).toContain('never assert it as a league rule')
  })
})

describe('an unknown imported keeper rule remains unknown', () => {
  it('marks an absent keeper cost system unknown rather than defaulting it', () => {
    const resolved = resolveLeagueRules({ leagueType: 'keeper', keeperCount: 2 })
    expect(resolved.keeper.costSystem.provenance).toBe('unknown')
    expect(resolved.keeper.costSystem.value).toBeNull()
  })

  it('never reports an unknown future-pick rule as tradeable', () => {
    // Guessing "yes" prices assets that may not be movable. Null must stay null.
    const resolved = resolveLeagueRules({ leagueType: 'keeper', keeperCount: 2 })
    expect(resolved.keeper.futurePicksTradeable.value).not.toBe(true)
    expect(resolved.keeper.futurePicksTradeable.provenance).toBe('unknown')
  })

  it('prefers the league setting when one IS on file', () => {
    const resolved = resolveLeagueRules({
      leagueType: 'keeper',
      keeperCount: 3,
      keeperCostSystem: 'round_penalty',
    })
    expect(resolved.keeper.costSystem.provenance).toBe('league_setting')
    expect(resolved.keeper.costSystem.value).toBe('round_penalty')
  })

  it('prints the unknown instead of omitting it', () => {
    /*
     * An omitted rule reads to the model as "no such rule" — a different and
     * wrong claim, and the one that produces an invented keeper policy.
     */
    const text = buildLeagueRulesGrounding({ leagueType: 'keeper', keeperCount: 2 }) ?? ''
    expect(text).toContain('NOT ON FILE')
    expect(text).toContain('do not substitute a default')
  })
})

describe('Survivor All-Stars Guillotine is traced to mechanics, not to its name', () => {
  const entry = getConceptById('survivor_guillotine')

  it('exists as its own entry', () => {
    expect(entry).not.toBeNull()
  })

  it('eliminates by score and explicitly not by vote', () => {
    // The half it takes from Guillotine, against the half it takes from Survivor.
    expect(entry?.elimination).toMatch(/never by vote/i)
    expect(entry?.elimination).toMatch(/lowest scorer/i)
  })

  it('forbids trades outright', () => {
    const trade = entry?.actions.find((a) => a.id === 'trade')
    expect(trade?.legalInFormat).toBe(false)
  })

  it('carries the growing lineup schedule including the week-9 superflex', () => {
    const phaseText = (entry?.phases ?? []).map((p) => `${p.label} ${p.summary}`).join(' ')
    expect(phaseText).toMatch(/SUPERFLEX/)
    expect(phaseText).toMatch(/Week 9/i)
  })

  it('is not reachable by classification, only by explicit id', () => {
    /*
     * No classifier emits this concept. Claiming one would make the resolver
     * assert this format about leagues that are not it.
     */
    expect(entry?.formatRulesConcept).toBeNull()
  })
})

describe('a format that forbids an action says so loudly', () => {
  it('tells the model never to suggest a trade in a no-trade format', () => {
    const bestBall = resolveLeagueRules({ leagueType: 'best_ball' })
    // best_ball has no classifier concept, so drive the renderer from the entry directly.
    expect(bestBall.concept).toBeNull()

    const entry = getConceptById('best_ball')
    expect(entry?.actions.find((a) => a.id === 'set_lineup')?.legalInFormat).toBe(false)
  })

  it('emits the NOT POSSIBLE block for a tournament league', () => {
    const text = buildLeagueRulesGrounding({ leagueType: 'tournament' }) ?? ''
    expect(text).toContain('NOT POSSIBLE IN THIS FORMAT')
  })
})

describe('an unclassifiable league gets an honest blank, not invented rules', () => {
  it('names the raw concept and forbids format mechanics', () => {
    const text = buildLeagueRulesGrounding({ leagueType: 'something-we-do-not-know' }) ?? ''
    expect(text).toContain('not documented in the catalog')
    expect(text).toContain('Do not describe format-specific mechanics')
  })
})
