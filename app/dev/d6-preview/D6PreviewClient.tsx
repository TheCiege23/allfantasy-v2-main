'use client'

/**
 * D.6 — dev preview client. Renders the four-column bottom dock + War Room popup
 * with synthetic data so a headless preview can screenshot the layout without
 * auth. Not for production.
 */

import { WarRoomPopup } from '@/components/app/draft-room/WarRoomPopup'
import {
  ResultsRosterPanel,
  type ResultsRosterPanelTeam,
  type ResultsRosterPanelPick,
} from '@/components/app/draft-room/ResultsRosterPanel'
import { DraftRightDockTabs } from '@/components/app/draft-room/DraftRightDockTabs'

const MOCK_TEAMS: ResultsRosterPanelTeam[] = [
  { rosterId: 'r1', displayName: 'TheCiege24', isCurrentUser: true },
  { rosterId: 'r2', displayName: 'RhhNiner' },
  { rosterId: 'r3', displayName: 'Freshstatic', isAi: true },
  { rosterId: 'r4', displayName: 'JohnBailey33' },
  { rosterId: 'r5', displayName: 'Slot 5' },
  { rosterId: 'r6', displayName: 'Slot 6' },
]

const MOCK_PICKS: ResultsRosterPanelPick[] = [
  { rosterId: 'r1', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', overall: 1 },
  { rosterId: 'r1', playerName: "Ja'Marr Chase", position: 'WR', team: 'CIN', overall: 12 },
  { rosterId: 'r1', playerName: 'Patrick Mahomes', position: 'QB', team: 'KC', overall: 25 },
  { rosterId: 'r1', playerName: 'Jahmyr Gibbs', position: 'RB', team: 'DET', overall: 36 },
  { rosterId: 'r1', playerName: 'Justin Jefferson', position: 'WR', team: 'MIN', overall: 49 },
  { rosterId: 'r1', playerName: 'Trey McBride', position: 'TE', team: 'ARI', overall: 60 },
  { rosterId: 'r1', playerName: 'Harrison Butker', position: 'K', team: 'KC', overall: 144 },
]

const STARTER_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1 }

export function D6PreviewClient() {
  return (
    <div className="flex h-screen min-h-[100dvh] flex-col bg-[#040915] text-white">
      {/* Mock top bar */}
      <header className="shrink-0 border-b border-white/10 bg-[#070f21] px-4 py-2 text-[12px] uppercase tracking-[0.18em] text-white/55">
        D.6 dev preview — bottom dock + War Room popup
      </header>

      {/* D.6.2 — mock top bar centered around the prominent clock pill */}
      <div className="shrink-0 border-b border-white/10 bg-[#070f21] px-4 py-2">
        <div className="flex items-center justify-center">
          <div
            data-testid="d6-preview-clock"
            className="inline-flex min-h-[52px] items-center gap-3 rounded-full border border-cyan-400/40 bg-gradient-to-br from-cyan-500/22 to-violet-600/15 px-6 py-3 text-2xl font-extrabold tabular-nums text-cyan-50 shadow-[0_10px_32px_rgba(0,0,0,0.4)]"
          >
            <span aria-hidden>⏱</span>
            <span>0:21</span>
          </div>
        </div>
      </div>

      {/* Mock board zone (top half-ish) */}
      <div
        className="shrink-0 border-b border-white/8 bg-[#050c1d] p-4 text-center text-white/35"
        style={{ minHeight: 'min(52vh, 640px)' }}
      >
        <div className="text-[10px] uppercase tracking-[0.2em]">[mock] Draft board lives here (~52vh)</div>
      </div>

      {/* 4-column bottom dock — shown at xl+ widths. Below xl the page collapses
          into stacked rows so the screenshot still proves each panel renders. */}
      <div
        data-testid="d6-preview-dock"
        className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row"
      >
        <section
          data-testid="d6-preview-pool"
          className="flex min-h-0 min-w-0 basis-0 flex-col overflow-hidden border-b border-white/8 xl:flex-[6] xl:border-b-0 xl:border-r"
        >
          <div className="shrink-0 border-b border-white/8 bg-[#0a1228] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Players (≈50%)
          </div>
          <div className="flex-1 overflow-auto p-3">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/55">
                  <th className="px-2 py-1 text-right">RK</th>
                  <th className="px-2 py-1 text-left">PLAYER</th>
                  <th className="px-2 py-1 text-right">ADP</th>
                  <th className="px-2 py-1 text-right">AI ADP</th>
                  <th className="px-2 py-1 text-right">PTS</th>
                  <th className="px-2 py-1 text-right">AVG</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['1', "Ja'Marr Chase", 'WR · CIN', '1.5', '1.7', '320', '20.0'],
                  ['2', 'Bijan Robinson', 'RB · ATL', '2.4', '2.9', '290', '17.1'],
                  ['3', 'Saquon Barkley', 'RB · PHI', '2.8', '2.0', '305', '17.9'],
                  ['4', 'Justin Jefferson', 'WR · MIN', '4.1', '4.8', '275', '17.2'],
                  ['5', 'Patrick Mahomes', 'QB · KC', '24.5', '—', '380', '22.4'],
                ].map(([rk, name, sub, adp, aiAdp, pts, avg]) => (
                  <tr key={rk} className="border-b border-white/5 hover:bg-white/[0.05]">
                    <td className="px-2 py-1.5 text-right text-white/55">{rk}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-semibold text-white/95">{name}</div>
                      <div className="text-[10px] text-white/45">{sub}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{adp}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{aiAdp}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pts}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{avg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* D.6.1 — single shared right dock with QUEUE / ROSTER / CHAT tabs. */}
        <section
          data-testid="d6-preview-right-dock"
          className="flex min-h-[260px] min-w-0 basis-0 flex-col overflow-hidden border-t border-white/8 xl:flex-[4] xl:border-t-0"
        >
          <DraftRightDockTabs
            defaultTab="queue"
            queueCount={3}
            queueBody={
              <ul className="flex-1 overflow-auto p-2 text-[12px]">
                {['Tee Higgins', 'Mike Evans', 'James Cook'].map((p) => (
                  <li
                    key={p}
                    className="mb-1 flex items-center justify-between rounded border border-white/10 bg-black/25 px-2 py-1.5"
                  >
                    <span>{p}</span>
                    <button
                      type="button"
                      className="rounded border border-cyan-400/35 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-100"
                    >
                      Draft
                    </button>
                  </li>
                ))}
              </ul>
            }
            rosterBody={
              <ResultsRosterPanel
                teams={MOCK_TEAMS}
                picks={MOCK_PICKS}
                currentUserRosterId="r1"
                starterSlots={STARTER_SLOTS}
                benchSlots={3}
                idpEnabled={false}
              />
            }
            chatBody={
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex-1 overflow-auto p-3 text-[11px] text-white/55">
                  Welcome to the draft chat. Be respectful and have fun!
                </div>
                <div className="shrink-0 border-t border-white/10 bg-[#0a1228] p-2">
                  <input
                    type="text"
                    placeholder="Type a message…"
                    className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
                  />
                </div>
              </div>
            }
          />
        </section>
      </div>

      {/* War Room as floating popup. defaultOpen=false; opens via the trigger. */}
      <WarRoomPopup hasNewIntel triggerLabel="AF Legacy Draft Room">
        <div className="space-y-3 p-3 text-[12px] text-white/85">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Team</div>
            <div className="text-[14px] font-semibold">TheCiege24</div>
            <div className="text-[10px] text-white/55">12-Team NFL Redraft League · Slot 1</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Starter balance</div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded border border-cyan-400/35 bg-cyan-500/15 px-1.5 py-0.5">QB 1/1</span>
              <span className="rounded border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5">RB 1/2</span>
              <span className="rounded border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5">WR 1/2</span>
              <span className="rounded border border-rose-400/35 bg-rose-500/15 px-1.5 py-0.5">TE 0/1</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">AI guidance</div>
            <div className="mt-1 rounded border border-violet-400/30 bg-violet-500/10 p-2">
              <p className="text-[12px] font-semibold text-white">Tee Higgins (WR · CIN)</p>
              <p className="mt-1 text-[11px] text-white/70">
                Fills your critical WR2 need; ADP value at the current slot.
              </p>
            </div>
          </div>
        </div>
      </WarRoomPopup>
    </div>
  )
}
