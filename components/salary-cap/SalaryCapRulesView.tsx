'use client'

import { Settings, ArrowLeft } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { SalaryCapSummary } from './types'

export function SalaryCapRulesView({
  summary,
  leagueId,
  onBack,
}: {
  summary: SalaryCapSummary
  leagueId: string
  /** Absent inside the league workspace, whose sidebar already navigates (SalaryCapHome `shellNav`). */
  onBack?: () => void
}) {
  const c = summary.config

  return (
    <div className="space-y-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Settings className="h-5 w-5 text-white/60" />
          Rules & settings
        </h2>

        <h3 className="mb-2 text-sm font-medium text-white/80">Salary cap</h3>
        <dl className="mb-6 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-white/50">Startup cap</dt><dd className="text-white/90">${c.startupCap}</dd></div>
          <div><dt className="text-white/50">Cap growth</dt><dd className="text-white/90">{c.capGrowthPercent}%</dd></div>
          <div><dt className="text-white/50">Rollover</dt><dd className="text-white/90">{c.rolloverEnabled ? `Yes (max $${c.rolloverMax})` : 'No'}</dd></div>
        </dl>

        <h3 className="mb-2 text-sm font-medium text-white/80">Contract</h3>
        <dl className="mb-6 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-white/50">Min / max years</dt><dd className="text-white/90">{c.contractMinYears}–{c.contractMaxYears}</dd></div>
          <div><dt className="text-white/50">Rookie contract years</dt><dd className="text-white/90">{c.rookieContractYears}</dd></div>
          <div><dt className="text-white/50">Minimum salary</dt><dd className="text-white/90">${c.minimumSalary}</dd></div>
          <div><dt className="text-white/50">Dead money</dt><dd className="text-white/90">{c.deadMoneyEnabled ? 'On' : 'Off'}</dd></div>
          <div><dt className="text-white/50">Extensions</dt><dd className="text-white/90">{c.extensionsEnabled ? 'On' : 'Off'}</dd></div>
          <div><dt className="text-white/50">Franchise tag</dt><dd className="text-white/90">{c.franchiseTagEnabled ? 'On' : 'Off'}</dd></div>
        </dl>

        <h3 className="mb-2 text-sm font-medium text-white/80">Draft</h3>
        <dl className="mb-6 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-white/50">Startup</dt><dd className="text-white/90 capitalize">{c.startupDraftType?.replace(/_/g, ' ')}</dd></div>
          <div><dt className="text-white/50">Future draft</dt><dd className="text-white/90 capitalize">{c.futureDraftType?.replace(/_/g, ' ')}</dd></div>
          <div><dt className="text-white/50">Auction holdback</dt><dd className="text-white/90">${c.auctionHoldback}</dd></div>
          <div><dt className="text-white/50">Weighted lottery</dt><dd className="text-white/90">{c.weightedLotteryEnabled ? 'On' : 'Off'}</dd></div>
        </dl>

        {c.offseasonPhase && (
          <p className="text-xs text-white/50">Current offseason phase: {c.offseasonPhase}</p>
        )}

        <a
          href={`/league/${leagueId}?tab=Settings`}
          className="mt-4 inline-block text-sm text-cyan-400 hover:underline"
        >
          League Settings →
        </a>
      </section>

        {/* FAQ Section */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Salary Cap FAQ</h2>
          <div className="space-y-2">
            <FaqItem q="What is a Salary Cap league?">
              A Salary Cap league is a contract-based dynasty format where every player on your roster has a
              salary that counts against your team&apos;s annual cap space. Managing your cap is as important
              as picking the right players — you must keep your total contract commitments under the cap
              each year or face penalties.
            </FaqItem>

            <FaqItem q="How does the salary cap work?">
              Each team starts with the same cap amount (e.g., ${`${c.startupCap}`}). The sum of all active
              player salaries — plus any dead money charges — must stay at or below this number each season.
              The cap can grow annually ({c.capGrowthPercent}% per year by default), rewarding patient
              roster-building over time.
            </FaqItem>

            {c.rolloverEnabled && (
              <FaqItem q="What is cap rollover?">
                Any unspent cap space at the end of a season rolls over into your next season&apos;s budget
                (up to ${`${c.rolloverMax}`} maximum rollover). This rewards lean teams who stay cap-healthy and
                discourages wasteful spending. Rollover cap stacks on top of your base cap the following year.
              </FaqItem>
            )}

            {c.deadMoneyEnabled && (
              <FaqItem q="What is dead money?">
                When you release a player before their contract expires, you owe dead money — a cap charge for
                the remaining commitment you made. Dead money counts 100% against your cap in the current season,
                and {c.deadMoneyPercentPerYear}% of remaining years spill into the following season (max 2 seasons).
                This mechanic punishes over-extension on short-term roster fits.
              </FaqItem>
            )}

            <FaqItem q="How do rookie-scale contracts work?">
              After your startup draft or any future rookie draft, drafted players automatically receive
              contracts at their pick-position salary. Early picks receive higher salaries (reflecting
              their higher expected value); later picks are cheaper. Contracts last {c.rookieContractYears} years
              by default. This mirrors real-world entry-level deals — high picks command premium cap space,
              while late picks offer cap flexibility.
            </FaqItem>

            {c.startupDraftType === 'snake' && (
              <FaqItem q="How does the snake salary scale assign salaries?">
                In a snake salary-scale draft, each pick slot maps to a predetermined salary based on the
                league&apos;s cap size and configured curve (steep, linear, or flat). Pick 1.01 receives the
                maximum salary (~4.5% of cap); picks in later rounds receive progressively less, down to the
                minimum salary floor (${`${c.minimumSalary}`}). This creates a predictable, transparent market
                where draft position equals contractual commitment — no bidding required.
              </FaqItem>
            )}

            {c.startupDraftType === 'auction' && (
              <FaqItem q="How does the startup auction work?">
                In an auction draft, each team nominates players and all teams bid simultaneously. The highest
                bidder wins the player and that bid becomes the player&apos;s salary for the initial contract
                term. A holdback of ${`${c.auctionHoldback}`} is reserved until the draft completes — this
                prevents teams from spending all their cap in the early rounds. Final cap compliance is
                checked after the holdback is released.
              </FaqItem>
            )}

            <FaqItem q="How does FAAB work in a salary cap league?">
              FAAB and free agency work through your cap space, not a separate budget. To sign a free agent
              mid-season, the salary you offer counts against your available cap. You cannot sign a player if
              the salary would push you over your cap limit. This means unlike standard leagues, you can&apos;t
              simply outbid everyone — you need cap room.
            </FaqItem>

            {c.extensionsEnabled && (
              <FaqItem q="How do contract extensions work?">
                Each team can extend one player per season. Extensions add up to 3 additional years to a
                player&apos;s contract before it expires. Salary for the extension years is calculated based on
                either a performance formula or a stable continuation of the existing deal (commissioner&apos;s
                choice). Extensions lock a player to your roster — you can&apos;t extend then immediately cut.
              </FaqItem>
            )}

            {c.franchiseTagEnabled && (
              <FaqItem q="How does the franchise tag work?">
                The franchise tag lets you retain one expiring player per offseason at a premium salary — the
                average of the top 8 salaries at that position. Tagged players receive a 1-year contract at
                that rate. You can only franchise-tag each player once across their career in your league.
                The tag prevents losing elite players to free agency but costs premium cap space.
              </FaqItem>
            )}

            <FaqItem q="What contract year allocations are allowed?">
              The number of multi-year contracts each team can hold is limited by allocation rules:
              1-year contracts are unlimited; 2-year contracts are capped at 3 per team; 3-year contracts
              at 2; 4-year contracts at 1. This mirrors real-world salary structures and prevents
              teams from stacking massive long-term deals at every position.
            </FaqItem>

            <FaqItem q="What is the difference between salary cap dynasty and standard dynasty?">
              Standard dynasty leagues track wins and losses based on player points — roster management is
              purely about acquiring and stashing the best players. Salary cap dynasty adds a financial
              dimension: every player has a cost, every move has cap implications, and financial discipline
              becomes a skill layer on top of talent evaluation. You can&apos;t simply collect every good
              player — you have to make hard choices about value vs. salary.
            </FaqItem>
          </div>
        </section>
    </div>
  )
}

  function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(false)
    return (
      <div className="rounded-xl border border-white/10 bg-black/20">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 p-4 text-left text-sm font-medium text-white/90 hover:text-white"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>{q}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {open && (
          <div className="border-t border-white/10 px-4 pb-4 pt-3 text-sm text-white/70">
            {children}
          </div>
        )}
      </div>
    )
  }
