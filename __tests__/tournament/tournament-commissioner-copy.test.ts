/**
 * The tournament commissioner dashboard speaks to commissioners, not developers (2026-11-09, tournament gaps audit
 * item 5). It told them to "Assign via API POST /api/tournament/[id]/mini-commissioners or extend the hub UI later",
 * that drafts were "stored in hub draftScheduleV1", that standings were a "payload from the tournament standings
 * API", that co-commissioners "propose league.settings patches", and that automation was "persisted in hub settings;
 * job runners honor flags when enabled server-side". Both languages and the hard-coded panel copy are checked.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { translations } from '@/lib/i18n/translations'

// API and POST are case-sensitive: "Post update" is a button, "POST" is an HTTP verb.
const DEV_TERMS = /\bAPI\b|\bPOST\b/
const DEV_PHRASES = /\/api\/|payload|endpoint|draftScheduleV1|league\.settings|server-side|job runners|heuristics?|wire to|hub UI|guardrail|guardarra|patches|parches|persist/i
const DEV_WORDS = { test: (t: string) => DEV_TERMS.test(t) || DEV_PHRASES.test(t) }

describe('Tournament commissioner copy', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`${lang}: no commissioner string uses developer language`, () => {
      const dict = (translations as Record<string, Record<string, string>>)[lang]
      const bad = Object.entries(dict)
        .filter(([k]) => k.startsWith('tournament.commissioner.') || k.startsWith('tournament.appCommissioner.'))
        .filter(([, v]) => DEV_WORDS.test(v))
      expect(bad).toEqual([])
    })
  }

  it.each([
    'components/tournament/TournamentAiOperationsCenter.tsx',
    'components/tournament/TournamentApprovalsCenter.tsx',
    'components/tournament/TournamentHistoryArchivePanel.tsx',
  ])('%s: no developer language in what it shows', (rel) => {
    // Only text a person sees: JSX text, subtitle/hint/label props. Fetch URLs and identifiers are code, not copy.
    const visible = readFileSync(rel, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/fetch\(|encodeURIComponent|^\s*(import|\/\/|\*)/.test(l))
      .join('\n')
    const shown = [
      ...visible.matchAll(/(?:subtitle|hint|label|title)=["']([^"']+)["']/g),
      ...visible.matchAll(/(?:hint|label|subtitle): '([^']+)'/g),
      ...visible.matchAll(/>\s*([^<>{}]*[A-Za-z][^<>{}]*)\s*</g),
    ].map((m) => m[1]!.trim())
    expect(shown.filter((t) => DEV_WORDS.test(t))).toEqual([])
  })
})
