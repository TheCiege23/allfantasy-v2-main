"use client";

import { useLanguage } from "@/components/i18n/LanguageProviderClient";

/**
 * How this league priced its kickers, from `meta.kickerValuation` on the rankings engine.
 *
 * ⚠ THERE IS NO PER-KICKER NUMBER TO RENDER, AND THAT IS THE FINDING RATHER THAN A GAP. Every
 * kicker in a league gets the same value: kicker rank does not persist year to year (Spearman
 * -0.455, negative in all six measured season pairs) or within a season, and the startable
 * position spans only 1.55x. `lib/kicker-values/leagueKickerValue.ts` carries the measurement.
 */
export interface KickerValuationView {
  value: number | null;
  replacementRank: number;
  rankPredictability: "none";
  basis: string;
}

/**
 * ⚠ A FLAT NUMBER WITH NO EXPLANATION IS WORSE THAN THE LADDER IT REPLACED. Before this, a
 * manager's K1 and K30 were priced 1200 and 100 apart on Sleeper's `search_rank` — a popularity
 * poll. Now they are equal, which is correct but reads as a bug unless the surface says why. So
 * the sentence is the point of this component, not the number.
 *
 * ⚠ ITS OWN FILE ON PURPOSE. It began inside `page.tsx`, but that file is 2,100+ lines and pulls
 * next-auth, the i18n provider and most of the rankings UI into any module graph that touches
 * it — a render test importing the page timed the vitest worker out before a single assertion
 * ran, twice. Same trap `lib/idp-kicker-values.ts` documents at its top for the rankings engine.
 */
export function KickerValuationBand({
  valuation,
  teamTotal,
  formatValue,
}: {
  valuation: KickerValuationView | null;
  /** This team's kicker total, to match the QB/RB/WR/TE tiles it sits under. */
  teamTotal: number;
  formatValue: (value: number) => string;
}) {
  const { t, tInterpolate } = useLanguage();

  /*
   * `value` is null in a league that starts no kicker — there a kicker is not an asset at all,
   * and quoting a price would invent a market for a player nobody can field.
   */
  if (!valuation || valuation.value === null) return null;

  return (
    <div className="mt-4 rounded-xl border border-white/8 bg-[#0c0c1e] p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">
          {t("powerRankingsPage.position.kickers")}
        </div>
        {/* Team total, to match the four tiles above; the per-kicker number is the league's and
            belongs in the sentence, not in a tile a reader would scan as a ranking. */}
        <div className="text-lg font-black text-white">{formatValue(teamTotal)}</div>
      </div>
      <div className="mt-1 text-sm text-white/60">
        {tInterpolate("powerRankingsPage.position.kickerEach", {
          value: valuation.value.toLocaleString(),
        })}
      </div>
      <p className="mt-2 text-xs leading-5 text-white/45">
        {tInterpolate("powerRankingsPage.position.kickerBasis", {
          rank: String(valuation.replacementRank),
        })}
      </p>
    </div>
  );
}
