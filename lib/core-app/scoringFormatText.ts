import { messagesFor } from '@/lib/i18n/messages'
import { scoringFormatMessages } from './messages/scoringFormat'

type Term = keyof typeof scoringFormatMessages.en

/**
 * The lower-case codes `League.scoring` holds when a provider or the AF wizard stored a code rather
 * than a label: ESPN / Yahoo / MFL write `standard` / `half` / `ppr` (their adapters'
 * `detect*ScoringFormat`), the AF wizard writes a preset id (`half_ppr`, `standard`). A WHOLE-label
 * match only — a code inside a longer string is somebody's free text and is left alone.
 */
const CODE: Record<string, Term> = {
  standard: 'standard',
  half: 'halfPpr',
  half_ppr: 'halfPpr',
  'half-ppr': 'halfPpr',
  'half ppr': 'halfPpr',
  'non-ppr': 'nonPpr',
  non_ppr: 'nonPpr',
  'standard scoring': 'standardScoring',
}

/**
 * The written labels, wherever they sit in a combined label: the Sleeper mapper's "Half PPR Superflex
 * TEP" (lib/league-import/adapters/sleeper/SleeperLeagueMapper.ts), `receptionScoringLabel`'s "Half PPR"
 * / "Standard", lib/leagues/leagueFormatLabel.ts's "Half-PPR". Longest first, so "Standard scoring" is
 * not read as "Standard" + " scoring".
 */
const WRITTEN: Array<[RegExp, Term]> = [
  [/\bStandard scoring\b/g, 'standardScoring'],
  [/\bHalf[- ]PPR\b/g, 'halfPpr'],
  [/\bNon-PPR\b/g, 'nonPpr'],
  [/\bStandard\b/g, 'standard'],
]

/**
 * A league's scoring label in the reader's language. Only the scoring-format words change; "PPR",
 * "Superflex", "TEP" and every other part of the label pass through, so "Half PPR Superflex TEP" reads
 * «Medio PPR Superflex TEP». English (and any language without its own terms) returns the label
 * untouched — the same string, not a re-built one.
 *
 * PURE and client-safe.
 */
export function scoringFormatText(label: string, language: string | null | undefined): string {
  const m = messagesFor(scoringFormatMessages, language)
  if (m === scoringFormatMessages.en) return label
  const code = CODE[label.trim().toLowerCase()]
  if (code) return m[code]
  let out = label
  for (const [re, term] of WRITTEN) out = out.replace(re, m[term])
  return out
}
