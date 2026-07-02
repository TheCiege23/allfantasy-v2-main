import { useEffect, useMemo, useState } from 'react'
import {
  buildNflRedraftTradeRuntimeState,
  buildTradeLifecycleEvents,
  executeNflRedraftTrade,
  validateNflRedraftTradeProposal,
  type NflRedraftTradeProposalInput,
  type NflRedraftTradeRosterInput,
  type NflRedraftTradeRulesInput,
  type NflRedraftTradeRuntimeState,
  type NflRedraftTradeTransactionInput,
} from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'

const rules: NflRedraftTradeRulesInput = {
  draft: { pickTradingEnabled: true },
  permissions: { memberMovesLocked: false },
  roster: { lockAllMoves: false, size: 4 },
  trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: true },
}

const initialRosters: NflRedraftTradeRosterInput[] = [
  {
    rosterId: 'alpha',
    displayName: 'Alpha',
    ownerId: 'user-alpha',
    faabBalance: 100,
    players: [
      { playerId: 'a-qb', playerName: 'Alpha QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
      { playerId: 'a-rb', playerName: 'Alpha RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
    ],
  },
  {
    rosterId: 'beta',
    displayName: 'Beta',
    ownerId: 'user-beta',
    faabBalance: 40,
    players: [
      { playerId: 'b-wr', playerName: 'Beta WR', position: 'WR', sport: 'NFL', slotType: 'BENCH' },
      { playerId: 'b-te', playerName: 'Beta TE', position: 'TE', sport: 'NFL', slotType: 'BENCH' },
    ],
  },
]

const acceptProposal: NflRedraftTradeProposalInput = {
  proposalId: 'accept-trade',
  proposerRosterId: 'alpha',
  receiverRosterId: 'beta',
  status: 'pending',
  vetoMode: 'commissioner',
  vetoThreshold: 2,
  createdAtIso: '2026-07-02T12:00:00.000Z',
  expiresAtIso: '2026-07-03T12:00:00.000Z',
  assets: [
    { fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'a-rb', playerName: 'Alpha RB' },
    { fromRosterId: 'beta', toRosterId: 'alpha', assetType: 'player', playerId: 'b-wr', playerName: 'Beta WR' },
    { fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'faab', metadata: { amount: 10 } },
  ],
}

const vetoProposal: NflRedraftTradeProposalInput = {
  proposalId: 'veto-trade',
  proposerRosterId: 'alpha',
  receiverRosterId: 'beta',
  status: 'pending',
  vetoMode: 'commissioner',
  vetoThreshold: 2,
  createdAtIso: '2026-07-02T12:05:00.000Z',
  expiresAtIso: '2026-07-03T12:05:00.000Z',
  assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'future_consideration' }],
}

function buildState(input: {
  rosters: NflRedraftTradeRosterInput[]
  proposals: NflRedraftTradeProposalInput[]
  transactions?: NflRedraftTradeTransactionInput[]
}) {
  return buildNflRedraftTradeRuntimeState({
    leagueId: 'g39-browser-league',
    seasonId: 'g39-browser-season',
    season: 2026,
    week: 6,
    rules,
    rosters: input.rosters,
    proposals: input.proposals,
    transactions: input.transactions ?? [],
    activeRosterLimit: 4,
    pickInventorySupported: false,
    now: new Date('2026-07-02T12:00:00.000Z'),
  })
}

function rostersFromRuntime(state: NflRedraftTradeRuntimeState): NflRedraftTradeRosterInput[] {
  return state.teams.map((team) => ({
    rosterId: team.rosterId,
    displayName: team.displayName,
    ownerId: team.ownerId,
    ownerName: team.ownerName,
    faabBalance: team.faabBalance,
    waiverPriority: team.waiverPriority,
    players: team.players,
    validationIssues: team.validationIssues,
  }))
}

function proposalFromRuntime(state: NflRedraftTradeRuntimeState, proposalId: string): NflRedraftTradeProposalInput | null {
  const proposal = state.proposals.find((row) => row.proposalId === proposalId)
  if (!proposal) return null
  return {
    proposalId: proposal.proposalId,
    proposerRosterId: proposal.proposerRosterId,
    receiverRosterId: proposal.receiverRosterId,
    status: proposal.status,
    vetoMode: proposal.vetoMode,
    vetoThreshold: proposal.vetoThreshold,
    reason: proposal.reason,
    expiresAtIso: proposal.expiresAtIso,
    createdAtIso: proposal.createdAtIso,
    acceptedAtIso: proposal.acceptedAtIso,
    rejectedAtIso: proposal.rejectedAtIso,
    cancelledAtIso: proposal.cancelledAtIso,
    processedAtIso: proposal.processedAtIso,
    assets: proposal.assets,
    votes: proposal.votes,
  }
}

const pageStyle = {
  minHeight: '100vh',
  background: '#020617',
  color: 'white',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  padding: '24px 16px',
} as const

const cardStyle = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 14,
  background: 'rgba(255,255,255,0.04)',
  padding: 16,
} as const

export default function G39TradeRuntimeHarnessPage() {
  const [state, setState] = useState(() => buildState({ rosters: initialRosters, proposals: [acceptProposal, vetoProposal] }))
  const [message, setMessage] = useState('Ready')
  const [events, setEvents] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  const alpha = state.teams.find((team) => team.rosterId === 'alpha')
  const beta = state.teams.find((team) => team.rosterId === 'beta')
  const pending = useMemo(() => state.proposals.filter((proposal) => proposal.status === 'pending'), [state.proposals])

  function submitProposal() {
    const created: NflRedraftTradeProposalInput = {
      proposalId: 'manager-proposal',
      proposerRosterId: 'alpha',
      receiverRosterId: 'beta',
      status: 'pending',
      vetoMode: 'league_vote',
      vetoThreshold: 1,
      createdAtIso: '2026-07-02T12:10:00.000Z',
      expiresAtIso: '2026-07-03T12:10:00.000Z',
      assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'draft_pick', pickSeason: 2027, pickRound: 2 }],
    }
    const validation = validateNflRedraftTradeProposal({
      state,
      proposerRosterId: created.proposerRosterId,
      receiverRosterId: created.receiverRosterId,
      assets: created.assets,
    })
    const currentProposals = state.proposals
      .map((proposal) => proposalFromRuntime(state, proposal.proposalId))
      .filter((proposal): proposal is NflRedraftTradeProposalInput => Boolean(proposal))
    setState(buildState({ rosters: rostersFromRuntime(state), proposals: [...currentProposals, created] }))
    setMessage(validation.ok ? `Proposal created: ${validation.warnings.join(' ') || 'validated'}` : validation.message)
    setEvents((prev) => [...buildTradeLifecycleEvents({ state, proposalId: created.proposalId, type: 'proposed' }).map((event) => event.type), ...prev])
  }

  function acceptTrade() {
    const result = executeNflRedraftTrade({
      state,
      proposalId: 'accept-trade',
      actorUserId: 'user-beta',
      now: new Date('2026-07-02T13:00:00.000Z'),
    })
    if (!result.ok) {
      setMessage(result.validation.ok ? 'Trade failed' : result.validation.message)
      return
    }
    const proposals = state.proposals
      .map((proposal) => (proposal.proposalId === result.proposal.proposalId ? result.proposal : proposal))
      .map((proposal) => proposalFromRuntime({ ...state, proposals: [proposal] }, proposal.proposalId))
      .filter((proposal): proposal is NflRedraftTradeProposalInput => Boolean(proposal))
    setState(buildState({ rosters: rostersFromRuntime({ ...state, teams: result.teams }), proposals, transactions: [result.transaction] }))
    setMessage('Trade accepted and rosters updated')
    setEvents((prev) => [...result.events.map((event) => event.type), ...prev])
  }

  function vetoTrade() {
    const proposals = state.proposals.map((proposal) =>
      proposal.proposalId === 'veto-trade'
        ? { ...proposal, status: 'vetoed' as const, processedAtIso: '2026-07-02T13:15:00.000Z' }
        : proposal,
    )
    const vetoEvents = [
      ...buildTradeLifecycleEvents({ state, proposalId: 'veto-trade', type: 'vetoed', actorUserId: 'commissioner' }),
      ...buildTradeLifecycleEvents({ state, proposalId: 'veto-trade', type: 'league_vote_failed', actorUserId: 'commissioner' }),
    ]
    setState(
      buildState({
        rosters: rostersFromRuntime(state),
        proposals: proposals
          .map((proposal) => proposalFromRuntime({ ...state, proposals: [proposal] }, proposal.proposalId))
          .filter((proposal): proposal is NflRedraftTradeProposalInput => Boolean(proposal)),
      }),
    )
    setMessage('Commissioner veto recorded')
    setEvents((prev) => [...vetoEvents.map((event) => event.type), ...prev])
  }

  function invalidTrade() {
    const validation = validateNflRedraftTradeProposal({
      state,
      proposerRosterId: 'alpha',
      receiverRosterId: 'beta',
      assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'b-te' }],
    })
    setMessage(validation.ok ? 'Unexpectedly valid' : validation.message)
  }

  return (
    <main style={pageStyle} data-testid="g39-trade-harness" data-hydrated={hydrated ? 'true' : 'false'}>
      <section style={{ margin: '0 auto', maxWidth: 1040 }}>
        <p style={{ color: 'rgba(165,243,252,0.74)', fontSize: 12, letterSpacing: 2.4, textTransform: 'uppercase' }}>
          NFL Redraft Runtime Proof
        </p>
        <h1 style={{ fontSize: 28, margin: '8px 0 18px' }}>Trade Runtime</h1>

        <div data-testid="trade-runtime-summary" style={{ ...cardStyle, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <Metric label="Pending" value={pending.length} />
          <Metric label="Processed" value={state.coverage.processedTrades} />
          <Metric label="Transactions" value={state.transactions.length} />
          <Metric label="Picks" value={state.settings.pickExecutionStatus} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>
          <button type="button" data-testid="submit-trade-proposal" onClick={submitProposal} style={buttonStyle('#22d3ee', '#06121a')}>
            Propose trade
          </button>
          <button type="button" data-testid="accept-trade" onClick={acceptTrade} style={buttonStyle('#34d399', '#06120c')}>
            Accept trade
          </button>
          <button type="button" data-testid="commissioner-veto-trade" onClick={vetoTrade} style={outlineButtonStyle('#fecdd3')}>
            Commissioner veto
          </button>
          <button type="button" data-testid="invalid-trade" onClick={invalidTrade} style={outlineButtonStyle('rgba(255,255,255,0.82)')}>
            Try invalid trade
          </button>
        </div>

        <p style={{ ...cardStyle, color: 'rgba(255,255,255,0.78)' }} data-testid="trade-message">
          {message}
        </p>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: 12 }}>
          <RosterCard testId="roster-alpha" name="Alpha" faab={alpha?.faabBalance} players={alpha?.players.map((player) => player.playerName) ?? []} />
          <RosterCard testId="roster-beta" name="Beta" faab={beta?.faabBalance} players={beta?.players.map((player) => player.playerName) ?? []} />
        </div>

        <div style={{ ...cardStyle, marginTop: 12 }} data-testid="trade-history">
          <p style={{ margin: 0, fontWeight: 700 }}>Runtime History</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
            {events.length
              ? events.map((event, index) => (
                  <span key={`${event}-${index}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '4px 8px' }}>
                    {event}
                  </span>
                ))
              : 'No events yet'}
          </div>
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p style={{ margin: 0, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{value}</p>
    </div>
  )
}

function RosterCard({ testId, name, faab, players }: { testId: string; name: string; faab?: number; players: string[] }) {
  return (
    <div style={cardStyle} data-testid={testId}>
      <p style={{ margin: 0, fontWeight: 800 }}>{name}</p>
      <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>FAAB {faab}</p>
      <ul style={{ color: 'rgba(255,255,255,0.78)', fontSize: 14, margin: '10px 0 0', paddingLeft: 18 }}>
        {players.map((player) => (
          <li key={player}>{player}</li>
        ))}
      </ul>
    </div>
  )
}

function buttonStyle(background: string, color: string) {
  return {
    background,
    border: 0,
    borderRadius: 10,
    color,
    cursor: 'pointer',
    fontWeight: 800,
    padding: '10px 12px',
  } as const
}

function outlineButtonStyle(color: string) {
  return {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 10,
    color,
    cursor: 'pointer',
    padding: '10px 12px',
  } as const
}
