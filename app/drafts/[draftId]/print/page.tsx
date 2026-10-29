/**
 * Draft-day kit (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 9): the printable draft board.
 *
 * One page, landscape, black on white: every manager's column, every round, picks made so far,
 * keepers already locked into their slots, and who owns each traded pick. For an in-person draft or a
 * wall board. Any league member can print it; it reads the same session the live room does.
 */
import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { buildKeeperLocks } from '@/lib/live-draft-engine/keeper/KeeperDraftOrder'
import type { KeeperSelection } from '@/lib/live-draft-engine/keeper/types'
import type { DraftType, SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { buildPrintBoard } from '@/lib/draft-day/printBoard'
import { PrintButton } from './PrintButton'

export const dynamic = 'force-dynamic'

export default async function PrintDraftBoardPage({ params }: { params: Promise<{ draftId: string }> }) {
  const auth = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = auth?.user?.id
  const { draftId } = await params
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent(`/drafts/${draftId}/print`)}`)

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context || context.kind !== 'live') notFound()
  if (!(await canAccessLeagueDraft(context.leagueId, userId))) notFound()

  const session = await prisma.draftSession.findUnique({
    where: { id: context.draftId },
    select: {
      rounds: true, teamCount: true, draftType: true, thirdRoundReversal: true, slotOrder: true, tradedPicks: true, keeperSelections: true, status: true,
      picks: { select: { overall: true, playerName: true, position: true, team: true }, orderBy: { overall: 'asc' } },
    },
  })
  if (!session || session.draftType === 'auction') notFound()

  const slotOrder = (Array.isArray(session.slotOrder) ? session.slotOrder : []) as unknown as SlotOrderEntry[]
  const tradedPicks = (Array.isArray(session.tradedPicks) ? session.tradedPicks : []) as unknown as TradedPickRecord[]
  const keeperSelections = (Array.isArray(session.keeperSelections) ? session.keeperSelections : []) as unknown as KeeperSelection[]
  const locks = buildKeeperLocks(keeperSelections, slotOrder, tradedPicks, session.teamCount, session.rounds, session.draftType as DraftType, session.thirdRoundReversal)
  const board = buildPrintBoard({
    rounds: session.rounds,
    teamCount: session.teamCount,
    draftType: session.draftType,
    thirdRoundReversal: session.thirdRoundReversal,
    slotOrder: slotOrder.map((s) => ({ slot: s.slot, rosterId: s.rosterId, displayName: s.displayName || `Team ${s.slot}` })),
    tradedPicks,
    picks: session.picks,
    keepers: locks.map((k) => ({ overall: k.overall, playerName: k.playerName, position: k.position, team: k.team })),
  })

  const printed = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <main className="af-print-board">
      <style>{`
        @page { size: landscape; margin: 8mm; }
        .af-print-board { background: #fff; color: #000; min-height: 100vh; padding: 16px; font-family: system-ui, sans-serif; }
        .af-print-board table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 10px; }
        .af-print-board th, .af-print-board td { border: 1px solid #555; padding: 3px 4px; vertical-align: top; }
        .af-print-board th { background: #eee; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .af-print-board td { height: 34px; overflow: hidden; }
        .af-print-board .lbl { color: #666; font-size: 8px; }
        .af-print-board .pl { font-weight: 700; line-height: 1.15; }
        .af-print-board .keeper { background: #f1f8f1; }
        .af-print-board .rd { width: 28px; text-align: center; font-weight: 700; }
        @media print { .af-print-hide { display: none !important; } .af-print-board { padding: 0; min-height: 0; } .af-print-board th { background: #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      `}</style>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{context.leagueName} — draft board</h1>
          <p style={{ fontSize: 11, color: '#555', margin: '2px 0 0' }}>
            {session.rounds} rounds · {session.teamCount} teams · {session.draftType === 'linear' ? 'linear' : session.thirdRoundReversal ? 'snake, 3rd-round reversal' : 'snake'} ·{' '}
            {board.picksMade} picks made · {board.keepers} keepers · printed {printed}
          </p>
        </div>
        <PrintButton label="Print" />
      </header>
      {board.managers.length === 0 ? (
        <p>The draft order has not been set yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th className="rd">Rd</th>
                {board.managers.map((m) => (
                  <th key={m.slot} title={m.displayName}>{m.slot}. {m.displayName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.round}>
                  <td className="rd">{row.round}</td>
                  {row.cells.map((c) => (
                    <td key={c.overall} className={c.kind === 'keeper' ? 'keeper' : undefined}>
                      <div className="lbl">{c.label}{c.kind === 'keeper' ? ' · K' : ''}{c.ownedBy ? ` → ${c.ownedBy}` : ''}</div>
                      {c.player ? <div className="pl">{c.player}</div> : null}
                      {c.detail ? <div className="lbl">{c.detail}</div> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
