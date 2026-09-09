import { describe, expect, it } from 'vitest'

import { classifyChimmyIntent } from '@/lib/chimmy-orchestration/intent-classifier'

/**
 * The stem-inside-\b defect, found a third time and fixed as a class.
 *
 * ── 🛑 THE SHAPE, WHICH THIS FILE'S SIBLING ALREADY DOCUMENTS ───────────────────────────────
 * A term inside `\b(...)\b` matches ONLY that exact word. `\bwaiver\b` does not match "waivers":
 * after "waiver" comes "s", a word character, so there is no boundary. The pattern is valid, the
 * regex runs, nothing throws — the question simply routes to `general` and gets a plausible answer.
 * `intent-classifier-psychology.test.ts` records the same bug in `\bpsycholog\b`, which could never
 * match "psychology", the single most obvious word for that intent.
 *
 * ⚠ AND IT IS WORSE THAN A MISSED SLICE, BECAUSE THE INTENT REACHES THE MODEL. The chat route
 * feeds this classification into `buildOrchestrationPromptSection`, so a waiver question routed to
 * `general` tells the answering model it is handling "General fantasy help". The routing is not a
 * silent internal detail; it steers the answer.
 *
 * ── WHY THIS FILE COVERS MORE THAN THE ONE REPORTED TERM ────────────────────────────────────
 * "waivers" was the reported case. Every assertion below was RED before the fix, which is the
 * evidence that the defect was a class rather than a typo — including two terms that could never
 * have matched anything at all:
 *
 *     `\boppone\b`        cannot match "opponent" — dead vocabulary in the matchup intent
 *     `power\s*rank\b`    cannot match "power rankings" — the dominant phrasing of that question
 */

/** message -> the intent it must reach. Every one of these was wrong before the fix. */
const CASES: Array<[string, string]> = [
  // The reported bug. "waivers" is how anyone actually says it.
  ['who should I claim off waivers this week?', 'waiver'],
  ['any good free agents left?', 'waiver'],
  ['thinking about streaming a defense', 'waiver'],

  // Dead vocabulary: `oppone` had no reachable match, so the matchup intent could
  // only fire on the other words in its group.
  ['who is my opponent this week', 'matchup'],
  ['tough matchups coming up', 'matchup'],

  // "power rankings" — the phrasing, not "power rank".
  ['what do the power rankings look like', 'league_strength'],

  // Plain plurals across the rest of the vocabulary.
  ['should I be trading for a RB', 'trade'],
  ['what are my draft picks worth', 'draft'],
  ['give me the week 3 recaps', 'story_recap'],
]

describe('the classifier matches the words people actually type', () => {
  for (const [message, intent] of CASES) {
    it(`routes "${message}" -> ${intent}`, () => {
      expect(classifyChimmyIntent(message).intent).toBe(intent)
    })
  }
})

/**
 * 🛑 THE OTHER HALF: WIDENING A PATTERN IS HOW YOU BREAK A CLASSIFIER.
 *
 * These branches are ordered, so any term added to an EARLY branch steals turns from every later
 * one. A fix that only proves the new matches work has tested the half that cannot embarrass it.
 * Each case below is a word that LOOKS like it should match a widened stem and must not.
 */
describe('the widening does not swallow unrelated questions', () => {
  const mustNotMatch: Array<[string, string]> = [
    // `add\w*` would match all three of these. It is not used, for this reason.
    ['what is the address for the league dues', 'waiver'],
    ['in addition to that, who is my best player', 'waiver'],
    // `sit\w*` would match "situation" — the start_sit stems are deliberately left alone.
    ['what is my playoff situation', 'start_sit'],
    // `stream\w*` is used, and this is the case that justifies checking it.
    ['downstream effects of the trade', 'waiver'],
  ]

  for (const [message, wrongIntent] of mustNotMatch) {
    it(`does NOT route "${message}" to ${wrongIntent}`, () => {
      expect(classifyChimmyIntent(message).intent).not.toBe(wrongIntent)
    })
  }
})

/**
 * ⚠ ONE DELIBERATE BEHAVIOUR CHANGE, PINNED SO IT IS A DECISION RATHER THAN A SURPRISE.
 *
 * Fixing `oppone` -> `opponents?` makes the matchup branch reachable, and matchup is ordered ABOVE
 * start_sit. So "who should I start against my opponent" now routes to `matchup` where it used to
 * fall through to `start_sit`.
 *
 * That is what the author intended: the matchup branch already carries a guard excluding an
 * explicit "start X or sit Y", which only makes sense if opponent questions were meant to reach it.
 * The guard was written for a term that could never fire. Both halves are pinned here.
 */
describe('matchup vs start_sit, now that the opponent term can fire', () => {
  it('an opponent question reaches matchup', () => {
    expect(classifyChimmyIntent('who should I start against my opponent').intent).toBe('matchup')
  })

  it('an explicit start-or-sit still reaches start_sit, guard intact', () => {
    expect(classifyChimmyIntent('should I start Mahomes or sit him against my opponent').intent).toBe(
      'start_sit',
    )
  })
})
