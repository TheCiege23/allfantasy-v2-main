/**
 * aiAdpConsumerFlag — the one switch that decides whether anything READS AI ADP.
 *
 * 🛑 THE WRITER IS SAFE TO RUN; THE READERS ARE NOT SAFE TO TURN ON. `ai_adp_snapshots` sat
 * at zero rows because `runAiAdpJob` had no scheduled caller, so eight surfaces read a table
 * nothing filled. Scheduling the writer fixes that — but the moment rows exist, those
 * surfaces change behaviour all at once, and two of them change it badly:
 *
 *   1. AI ADP OVERRIDES REAL ADP IN LIVE DRAFT RECOMMENDATIONS.
 *      `lib/draft-helper/RecommendationEngine.ts` `getAdp` returns `aiAdpByKey[key]` in
 *      PREFERENCE to the player's real `adp`, and then flips `hasRealAdp` true. The draft
 *      room requests it whenever `draftUISettings.aiAdpEnabled`, which defaults TRUE.
 *   2. DYNASTY LEAGUES GET SERVED THE REDRAFT BOARD.
 *      `getAiAdpForLeague` falls through sport/leagueType/format misses to
 *      `getAiAdp(sport, 'redraft', 'default')`. Production has 45 NFL dynasty leagues
 *      against 49 redraft, and the draft room never renders the `segment` field, so the
 *      substitution is invisible.
 *
 * And the data does not yet justify either. Excluding the 18 seed sessions that are 100%
 * `source: 'auto'`, the real segments are 6, 4 and 2 completed drafts. `minSampleSize` of 2
 * is the ONLY enforced gate; `lowSample` is advisory and no consumer reads it. An ADP built
 * from six drafts is not wrong to compute — it is wrong to hand to a drafting manager as
 * though it outranked the real board.
 *
 * So the writer ships enabled and the readers ship dark. The table accumulates real drafts;
 * flipping this is a separate decision with evidence behind it.
 *
 * ⚠ TO FLIP IT, DO NOT JUST SET THE VARIABLE. Require, in order:
 *   - a segment with `totalDrafts` comfortably above {@link AI_ADP_MIN_DRAFTS_TO_PUBLISH},
 *     from drafts that are not `source: 'auto'`;
 *   - a decision on the dynasty fallback, because a dynasty league still cannot be served a
 *     redraft board honestly;
 *   - a decision on whether AI ADP should outrank real ADP at all in RecommendationEngine.
 *     Overriding a real board with a 6-draft one is the behaviour, not a side effect.
 */

/**
 * A segment built from fewer completed drafts than this is not published at all.
 *
 * Deliberately a WRITER-side floor rather than a reader-side filter: `lowSample` is stamped
 * onto entries and then read by nobody, so a threshold that only annotates protects nothing.
 * Three is not a claim that three drafts make a market — it keeps the 2-draft/16-pick segment
 * out of a table other code treats as authoritative.
 */
export const AI_ADP_MIN_DRAFTS_TO_PUBLISH = 3

/**
 * Whether any surface may READ `ai_adp_snapshots`. Default FALSE — an unset variable must
 * mean "off", so a new environment cannot switch draft recommendations on by omission.
 */
export function isAiAdpConsumerEnabled(): boolean {
  return String(process.env.AI_ADP_CONSUMERS_ENABLED ?? '').trim().toLowerCase() === 'true'
}
