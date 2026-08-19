'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CanonicalLeagueRules } from '@/lib/league-runtime/canonicalLeagueRules'
import {
  applyNflRedraftFreeAgentAdd,
  buildNflRedraftWaiverRuntimeState,
  processNflRedraftWaiverClaims,
  type NflRedraftWaiverClaimInput,
  type NflRedraftWaiverProcessResult,
  type NflRedraftWaiverRosterInput,
  type NflRedraftWaiverTransactionInput,
} from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'

const rules: CanonicalLeagueRules = {
  version: 1,
  leagueId: 'g38-browser-league',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 6,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G38 Browser League',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 2,
    rosterSize: 3,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {} as CanonicalLeagueRules['draft'],
  scoring: {} as CanonicalLeagueRules['scoring'],
  roster: {
    size: 3,
    starters: ['QB', 'RB'],
    irSlots: 0,
    eligibleReserveStatuses: [],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {
    type: 'faab',
    continuous: false,
    processingDays: [3],
    processingTimeUtc: '10:00',
    processingTimeLocal: '06:00',
    claimLimitPerPeriod: null,
    maxClaimsPerPeriod: null,
    priorityBehavior: 'rolling',
    gameLockBehavior: 'per_player',
    dropLockBehavior: 'locked_after_kickoff',
    freeAgentUnlockBehavior: 'after_clear',
    sameDayAddDropRules: null,
    faabEnabled: true,
    faabBudget: 100,
    faabMinBid: 1,
    faabResetRules: null,
    tiebreakRule: 'waiver_priority',
    instantFreeAgencyAfterClear: true,
  },
  trades: {} as CanonicalLeagueRules['trades'],
  playoffs: {} as CanonicalLeagueRules['playoffs'],
  schedule: {} as CanonicalLeagueRules['schedule'],
  permissions: {
    settingsEditableByRoles: ['commissioner', 'co_commissioner'],
    memberMovesLocked: false,
    inviteLinksDisabled: false,
    inviteCapacityOverride: false,
  },
  intelligence: {} as CanonicalLeagueRules['intelligence'],
}

const initialRosters: NflRedraftWaiverRosterInput[] = [
  {
    rosterId: 'alpha',
    displayName: 'Alpha Managers',
    ownerName: 'Alpha',
    faabBalance: 100,
    waiverPriority: 2,
    players: [
      { playerId: 'alpha-qb', playerName: 'Alpha QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
      { playerId: 'alpha-rb', playerName: 'Alpha RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
      { playerId: 'alpha-bn', playerName: 'Alpha Bench', position: 'WR', sport: 'NFL', slotType: 'BENCH' },
    ],
  },
  {
    rosterId: 'beta',
    displayName: 'Beta Managers',
    ownerName: 'Beta',
    faabBalance: 50,
    waiverPriority: 1,
    players: [
      { playerId: 'beta-qb', playerName: 'Beta QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
      { playerId: 'beta-rb', playerName: 'Beta RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
    ],
  },
]

const freeAgents = [
  { playerId: 'target-a', playerName: 'Target A', position: 'WR', team: 'BUF', sport: 'NFL', slotType: 'BENCH' },
  { playerId: 'target-b', playerName: 'Target B', position: 'TE', team: 'LV', sport: 'NFL', slotType: 'BENCH' },
]

const seededClaim: NflRedraftWaiverClaimInput = {
  claimId: 'beta-high',
  rosterId: 'beta',
  addPlayerId: 'target-a',
  addPlayerName: 'Target A',
  addPlayerPosition: 'WR',
  addPlayerTeam: 'BUF',
  bidAmount: 18,
  priority: 1,
  conditionalRank: 1,
  status: 'pending',
  submittedAtIso: '2026-07-02T11:58:00.000Z',
}

export default function G38WaiverRuntimeHarness() {
  const [rosters, setRosters] = useState(initialRosters)
  const [claims, setClaims] = useState<NflRedraftWaiverClaimInput[]>([seededClaim])
  const [transactions, setTransactions] = useState<NflRedraftWaiverTransactionInput[]>([])
  const [results, setResults] = useState<NflRedraftWaiverProcessResult[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  const state = useMemo(
    () =>
      buildNflRedraftWaiverRuntimeState({
        leagueId: 'g38-browser-league',
        seasonId: 'g38-browser-season',
        season: 2026,
        week: 5,
        rules,
        rosters,
        claims,
        transactions,
        freeAgents,
        now: new Date('2026-07-02T12:00:00.000Z'),
      }),
    [claims, rosters, transactions],
  )

  function submitClaim() {
    setHydrated(true)
    setClaims((prev) => [
      ...prev,
      {
        claimId: 'alpha-low',
        rosterId: 'alpha',
        addPlayerId: 'target-a',
        addPlayerName: 'Target A',
        addPlayerPosition: 'WR',
        addPlayerTeam: 'BUF',
        dropPlayerId: 'alpha-bn',
        dropPlayerName: 'Alpha Bench',
        bidAmount: 6,
        priority: 1,
        conditionalRank: 1,
        status: 'pending',
        submittedAtIso: '2026-07-02T12:01:00.000Z',
      },
    ])
  }

  function processWaivers() {
    setHydrated(true)
    const processed = processNflRedraftWaiverClaims({ state, actorUserId: 'commissioner' })
    setResults(processed.results)
    setRosters(
      processed.teams.map((team) => ({
        rosterId: team.rosterId,
        displayName: team.displayName,
        ownerName: team.ownerName,
        faabBalance: team.faabBalance,
        waiverPriority: team.waiverPriority,
        players: team.players,
      })),
    )
    setClaims([])
    setTransactions(processed.results.map((result) => result.transaction))
  }

  function addFreeAgent() {
    setHydrated(true)
    const applied = applyNflRedraftFreeAgentAdd({
      state,
      add: {
        rosterId: 'alpha',
        addPlayerId: 'target-b',
        addPlayerName: 'Target B',
        addPlayerPosition: 'TE',
        addPlayerTeam: 'LV',
        dropPlayerId: 'alpha-bn',
        dropPlayerName: 'Alpha Bench',
        actorUserId: 'user-alpha',
      },
      now: new Date('2026-07-02T12:10:00.000Z'),
    })
    if (!applied.ok) return
    setRosters(
      applied.teams.map((team) => ({
        rosterId: team.rosterId,
        displayName: team.displayName,
        ownerName: team.ownerName,
        faabBalance: team.faabBalance,
        waiverPriority: team.waiverPriority,
        players: team.players,
      })),
    )
    setTransactions((prev) => [applied.result.transaction, ...prev])
  }

  return (
    <main
      data-testid="g38-waiver-harness"
      data-hydrated={hydrated ? 'true' : 'false'}
      className="min-h-screen bg-[#080c10] px-4 py-5 text-white sm:px-8"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/70">NFL Redraft</p>
          <h1 className="mt-1 text-2xl font-black">Waiver Runtime Proof</h1>
          <p className="mt-2 text-sm text-white/55">Deterministic FAAB, pending claims, processing, free agency, roster changes, and transactions.</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-4" data-testid="waiver-runtime-summary">
          <Summary label="Mode" value={state.settings.mode.toUpperCase()} />
          <Summary label="Pending" value={String(state.coverage.pendingClaims)} />
          <Summary label="Transactions" value={String(state.coverage.processedTransactions)} />
          <Summary label="Free agents" value={String(state.coverage.freeAgentCount)} />
        </section>

        <section className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-3">
          <button data-testid="submit-waiver-claim" onClick={submitClaim} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-bold text-slate-950">
            Submit Alpha claim
          </button>
          <button data-testid="process-waivers" onClick={processWaivers} className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-bold text-slate-950">
            Process waivers
          </button>
          <button data-testid="add-free-agent" onClick={addFreeAgent} className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-bold text-slate-950">
            Add free agent
          </button>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Panel title="Pending Claims" testId="pending-claims">
            {state.pendingClaims.length === 0 ? (
              <p className="text-sm text-white/45">No pending claims.</p>
            ) : (
              <div className="space-y-2">
                {state.pendingClaims.map((claim) => (
                  <div key={claim.claimId} className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold">{claim.addPlayerName}</p>
                      <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-xs font-bold text-cyan-100">${claim.bidAmount}</span>
                    </div>
                    <p className="mt-1 text-xs text-white/50">
                      {claim.rosterId} claim {claim.claimId}
                      {claim.dropPlayerName ? ` - drop ${claim.dropPlayerName}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Results" testId="waiver-results">
            {results.length === 0 ? (
              <p className="text-sm text-white/45">Run waivers to see awarded and failed claims.</p>
            ) : (
              <div className="space-y-2">
                {results.map((result) => (
                  <div key={result.claimId} className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold">{result.claimId}</p>
                      <span className={result.success ? 'text-emerald-200' : 'text-rose-200'}>
                        {result.success ? 'won' : 'failed'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/50">
                      {result.addPlayerName}
                      {result.reason ? ` - ${result.reason}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Panel title="Rosters" testId="waiver-rosters">
            <div className="space-y-3">
              {state.teams.map((team) => (
                <div key={team.rosterId} data-testid={`roster-${team.rosterId}`} className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-bold">{team.displayName}</p>
                    <p className="text-xs text-white/55">FAAB ${team.faabBalance}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {team.players.map((player) => (
                      <span key={player.playerId} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs">
                        {player.playerName}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Transaction History" testId="transaction-history">
            {state.transactions.length === 0 ? (
              <p className="text-sm text-white/45">Transactions appear after waivers or free agency.</p>
            ) : (
              <div className="space-y-2">
                {state.transactions.map((tx) => (
                  <div key={tx.transactionId} className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="font-bold">{tx.type}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {tx.addPlayerName ?? tx.addPlayerId}
                      {tx.dropPlayerName ? ` for ${tx.dropPlayerName}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>
      </div>
    </main>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
      <p className="text-xs text-white/45">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  )
}

function Panel({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <h2 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-white/65">{title}</h2>
      {children}
    </section>
  )
}
