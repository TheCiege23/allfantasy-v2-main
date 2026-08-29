import type { Metadata } from 'next'

import {
  DEVY_BLEND_THRESHOLD,
  DEVY_COVERAGE,
  DEVY_OVERALL_AGREEMENT,
  DEVY_SIGNAL_AGREEMENT,
  EVIDENCE_MEASURED_ON,
  IDP_CEILING_NOTE,
  IDP_VORP_CONTROL,
  KICKER_FLATNESS,
  KICKER_MEASURED_SPREAD,
  KICKER_OLD_LADDER,
  KICKER_SAMPLE,
  KICKER_WITHIN_MEAN_RHO,
  KICKER_WITHIN_SEASON,
  KICKER_YEAR_OVER_YEAR,
  KICKER_YOY_MEAN_RHO,
} from '@/lib/values/publishedValueEvidence'

/**
 * The public record for the three positions no market prices.
 *
 * 🛑 DELIBERATELY PUBLIC AND DELIBERATELY DATA-FREE. It states MEASUREMENTS, never a user's
 * league or roster, so it needs no session and leaks nothing. Adding a league lookup here
 * would turn a marketing page into an authenticated surface and change what it is.
 *
 * ⚠ EVERY FIGURE COMES FROM `lib/values/publishedValueEvidence.ts`, WHICH IS PINNED TO THE
 * PRICING CODE BY TEST. Hardcoding a number into this JSX would let the page keep claiming a
 * correlation after the model stopped acting on it — a confident public statement backed by
 * nothing, which is the specific failure this whole stack exists to avoid.
 *
 * ⚠ THIS PAGE COSTS ONE ROUTE, spent knowingly. The repo sits near Vercel's 2048-route
 * ceiling; `scripts/audit-route-budget.cjs` is the check. Do not add sibling pages here —
 * extend this one.
 */

export const metadata: Metadata = {
  title: 'Kicker, IDP and Devy Values | AllFantasy',
  description:
    'What a kicker, a defender and a college prospect are actually worth — with the measurements behind each number, including the ones that say we cannot tell you.',
  openGraph: {
    title: 'Kicker, IDP and Devy Values | AllFantasy',
    description:
      'Kicker rank does not carry year to year. We measured it across seven seasons and priced the position accordingly.',
    siteName: 'AllFantasy',
  },
  twitter: { card: 'summary_large_image', title: 'Kicker, IDP and Devy Values | AllFantasy' },
}

const rho = (n: number) => (n > 0 ? `+${n.toFixed(3)}` : n.toFixed(3))
const pct = (n: number) => `${Math.round(n * 100)}%`

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#5d648a]">
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] p-[15px]">{children}</div>
  )
}

export default function PlayerValuesPage() {
  return (
    <div className="min-h-screen bg-[#06070f] px-5 pb-24 pt-10 text-[#eef0fa] md:px-10">
      <div className="mx-auto max-w-[860px]">
        <header className="mb-9">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#5d648a]">
            AllFantasy · measured {EVIDENCE_MEASURED_ON}
          </div>
          <h1 className="mt-2 text-[28px] font-black leading-[1.15] tracking-[-0.03em] md:text-[34px]">
            What a kicker, a defender and a college prospect are actually worth
          </h1>
          <p className="mt-3 max-w-[620px] text-[13px] leading-[1.6] text-[#8f97bd]">
            No market prices any of these three. Everyone else either leaves them out or invents a
            number. We measured them — and where the measurement says we cannot tell you, this page
            says so instead of guessing.
          </p>
        </header>

        <div className="flex flex-col gap-[26px]">
          {/* ---------------------------------------------------------------- kickers */}
          <section>
            <Label>Kickers — priced as a position, not as players</Label>
            <Card>
              <p className="text-[13px] leading-[1.6] text-[#c3c9e6]">
                Every kicker in a league is worth the same on AllFantasy. That is not a gap we have
                not filled — it is what {KICKER_SAMPLE.games.toLocaleString()} kicker games from{' '}
                {KICKER_SAMPLE.seasons} say.
              </p>

              <div className="mt-4">
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
                  Does this year&apos;s kicker rank predict next year&apos;s?
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {KICKER_YEAR_OVER_YEAR.map((p) => (
                    <div
                      key={p.label}
                      className="rounded-[9px] border border-white/[0.07] bg-[#06070f] px-2.5 py-2"
                    >
                      <div className="font-mono text-[13px] font-black text-[#fbbf24]">
                        {rho(p.rho)}
                      </div>
                      <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[#5d648a]">
                        {p.label}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2.5 text-[12px] leading-[1.55] text-[#8f97bd]">
                  Negative in all six pairs — mean {rho(KICKER_YOY_MEAN_RHO)}. Kicker rank does not
                  merely fail to carry, it inverts. Within a single season it is nothing at all
                  (mean {rho(KICKER_WITHIN_MEAN_RHO)} across {KICKER_WITHIN_SEASON.length} seasons,
                  weeks 1–9 against 10+).
                </p>
              </div>

              <div className="mt-5">
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
                  And the position is flat — share of K1&apos;s points per game
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left">
                    <thead>
                      <tr className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
                        {KICKER_FLATNESS.map((f) => (
                          <th key={f.rank} className="py-1.5 pr-3">
                            K{f.rank}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="font-mono text-[14px] font-black text-[#eef0fa]">
                        {KICKER_FLATNESS.map((f) => (
                          <td key={f.rank} className="py-1 pr-3">
                            {pct(f.share)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-2.5 text-[12px] leading-[1.55] text-[#8f97bd]">
                  The whole startable population sits inside {KICKER_MEASURED_SPREAD}. Nobody can
                  tell you who this year&apos;s K1 will be, and it would barely matter if they
                  could.
                </p>
              </div>

              <p className="mt-4 border-t border-white/[0.07] pt-3 text-[12px] leading-[1.55] text-[#8f97bd]">
                Our own previous ladder priced K1 at {KICKER_OLD_LADDER.topValue.toLocaleString()}{' '}
                and a backup at {KICKER_OLD_LADDER.floorValue} — a{' '}
                {KICKER_OLD_LADDER.impliedSpread} spread, ordered by name recognition. It was wrong
                by roughly eight times, and we deleted it.
              </p>
            </Card>
          </section>

          {/* -------------------------------------------------------------------- idp */}
          <section>
            <Label>IDP — defenders priced by your league&apos;s own rules</Label>
            <Card>
              <p className="text-[13px] leading-[1.6] text-[#c3c9e6]">
                Defenders are ranked, because the ordering is real. We check it against offensive
                players, where a market exists to check against: value over replacement orders them
                almost exactly as the market prices them.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {IDP_VORP_CONTROL.map((c) => (
                  <div
                    key={c.position}
                    className="rounded-[9px] border border-white/[0.07] bg-[#06070f] px-2.5 py-2"
                  >
                    <div className="font-mono text-[13px] font-black text-[#34d399]">
                      {c.spearman.toFixed(3)}
                    </div>
                    <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[#5d648a]">
                      {c.position} · n={c.n}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[12px] leading-[1.55] text-[#8f97bd]">
                So a defender&apos;s rank comes from your league&apos;s scoring settings and its
                starting slots — not from a generic board. A linebacker in a league that starts six
                is a different asset from the same player in a league that starts two.
              </p>

              <p className="mt-4 border-t border-white/[0.07] pt-3 text-[12px] leading-[1.55] text-[#8f97bd]">
                {IDP_CEILING_NOTE}
              </p>
            </Card>
          </section>

          {/* ------------------------------------------------------------------- devy */}
          <section>
            <Label>Devy — two opinions, reported rather than averaged</Label>
            <Card>
              <p className="text-[13px] leading-[1.6] text-[#c3c9e6]">
                College players have no trade market at all. We hold two signals — a scouting
                projection and where real drafters actually take them — and they disagree.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {DEVY_SIGNAL_AGREEMENT.map((d) => (
                  <div
                    key={d.position}
                    className="rounded-[9px] border border-white/[0.07] bg-[#06070f] px-2.5 py-2"
                  >
                    <div className="font-mono text-[13px] font-black text-[#fbbf24]">
                      {d.spearman.toFixed(3)}
                    </div>
                    <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[#5d648a]">
                      {d.position} · n={d.n}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[12px] leading-[1.55] text-[#8f97bd]">
                Overall {DEVY_OVERALL_AGREEMENT.spearman.toFixed(3)} across{' '}
                {DEVY_OVERALL_AGREEMENT.n} players carrying both signals. For comparison, the two
                market sources we DO blend for offensive players agree at{' '}
                {DEVY_BLEND_THRESHOLD.spearman.toFixed(3)}. Averaging two orderings that disagree
                this much produces a number neither of them supports, so we show you both and tell
                you when they conflict.
              </p>

              <p className="mt-4 border-t border-white/[0.07] pt-3 text-[12px] leading-[1.55] text-[#8f97bd]">
                Draft-behaviour data covers {DEVY_COVERAGE.withAdp} of{' '}
                {DEVY_COVERAGE.pool.toLocaleString()} players, and the gap is which schools we
                ingest rather than player quality — a prospect without it is unmeasured, not worse.
                A trade mixing college and NFL assets is reported ungradeable, because the
                probability a college player ever reaches the NFL has never been observed and we
                will not invent an exchange rate to hide that.
              </p>
            </Card>
          </section>

          <p className="text-[11px] leading-[1.6] text-[#5d648a]">
            Offensive player values come from FantasyCalc&apos;s market consensus. Everything on
            this page was measured against real league data on {EVIDENCE_MEASURED_ON} and is
            reproduced by the same constants the pricing code uses.
          </p>
        </div>
      </div>
    </div>
  )
}
