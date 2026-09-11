/**
 * Parse a pick label into structured data, or refuse.
 *
 * 🛑 THE CONTRACT IS "null MEANS WE COULD NOT READ IT", AND THE CALLER MUST HONOUR IT.
 * `/api/trade-evaluator` used to answer a null with `{ year: 2025, round: 1 }`, so any
 * string this function rejected — a typo, an empty field, a label in a format it did not
 * know — was graded as a FIRST-ROUND PICK. A draft pick is the closest thing this app has
 * to a financial instrument; conjuring the single most valuable one out of unreadable input
 * is the worst available default. Never restore a `?? 1`.
 *
 * Formats it handles:
 * - "2026 3rd Rd"            - "2025 4th"              - "2025 1st Round"
 * - "2026 2nd Rd (TheCiege24)"                          - "2025 Early 1st"
 * - "2026 Mid 2nd"           - "2024 Late 3rd"
 * - "2026 Round 3" / "2026 rd 3"  <- see below
 * - "2027 7th"                    <- see below
 *
 * ⚠ TWO FORMATS WERE ADDED 2026-09-11 BECAUSE REFUSING THEM WOULD HAVE BEEN A REGRESSION.
 * Once the caller stopped defaulting, every string this parser could not read became a hard
 * refusal of the whole trade — so anything legitimate it was quietly mis-reading had to be
 * made readable first, not turned into an error:
 *
 *   1. ROUNDS PAST THE FIFTH. The old pattern listed `1st|2nd|3rd|4th|5th` literally, so a
 *      perfectly ordinary "2027 6th" in a deeper rookie draft returned null and was priced
 *      as a first. `lib/pick-curve.ts` has always accepted any round (it holds the last
 *      observed share past the fifth rather than extrapolating), so there was never a
 *      pricing reason for the limit.
 *   2. "Round N" WORD FORM — and this one the route was generating ITSELF. `resolvePickData`
 *      builds `${year} Round ${round}` as the label for a structured pick, a string its own
 *      parser could not read back. A label you emit and cannot re-read is a bug waiting for
 *      the first round-trip.
 */

/** Rounds beyond this are not a draft, they are a typo. Bounds the parse, not the curve. */
const MAX_PARSEABLE_ROUND = 25

export type ParsedPick = {
  year: number;
  /**
   * 1-indexed draft round, 1..MAX_PARSEABLE_ROUND.
   *
   * ⚠ WIDENED FROM `1 | 2 | 3 | 4 | 5`. Kept as a plain number rather than a wider union
   * because the bound is a parse decision, not a type-level fact, and `lib/pick-curve.ts`
   * takes a number anyway.
   */
  round: number;
  bucket?: 'early' | 'mid' | 'late';
};

/** "2026 Early 3rd", "2026 3rd Rd" — the ordinal form. */
const ORDINAL = /(20\d{2})\s*(?:(early|mid|late)\s*)?(\d{1,2})(?:st|nd|rd|th)\b/i;
/** "2026 Round 3", "2026 rd 3" — the word form this repo emits and could not read back. */
const WORD = /(20\d{2})\s*(?:(early|mid|late)\s*)?(?:round|rd\.?)\s*(\d{1,2})\b/i;

export function parsePickLabel(label: string): ParsedPick | null {
  if (!label || typeof label !== 'string') return null;

  const clean = label.replace(/\([^)]*\)/g, '').trim();

  /*
   * Ordinal first. "2026 3rd Rd" matches BOTH patterns, and only the ordinal one reads it
   * correctly — WORD would find "Rd" with no digits after it and fail, but the ordering makes
   * the precedence explicit rather than accidental.
   */
  const m = clean.match(ORDINAL) ?? clean.match(WORD);
  if (!m) return null;

  const year = Number(m[1]);
  const round = Number(m[3]);

  /*
   * ⚠ A ZERO OR OUT-OF-RANGE ROUND MUST REFUSE HERE, because downstream it will not.
   * `pickRoundShare` in lib/pick-curve.ts does `Math.max(1, Math.round(round))`, so round 0
   * and every negative round silently BECOME a first-round pick — the same defect this file
   * exists to stop, one layer down. That clamp is left alone on purpose: it has 13 consumers
   * and holding the last observed share is correct for the deep-round case it was written
   * for. The fix is not to send it nonsense.
   */
  if (!Number.isInteger(round) || round < 1 || round > MAX_PARSEABLE_ROUND) return null;

  const bucketRaw = m[2]?.toLowerCase() as 'early' | 'mid' | 'late' | undefined;

  const result: ParsedPick = { year, round };
  if (bucketRaw) {
    result.bucket = bucketRaw;
  }

  return result;
}

export function formatPickForHistorical(parsed: ParsedPick): {
  year: number;
  round: number;
  tier: 'early' | 'mid' | 'late' | undefined;
} {
  return {
    year: parsed.year,
    round: parsed.round,
    tier: parsed.bucket
  };
}
