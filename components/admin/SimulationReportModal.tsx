'use client'

import { X, Trophy, Skull, Shield, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SimulatedWeek {
  week: number
  events: string[]
  eliminated?: string
  immunityWinner?: string
}

interface SimulationReport {
  leagueType: string
  leagueVariant: string | null
  sport: string
  weeksSimulated: number
  playerCount: number
  champion: string | null
  runnerUp: string | null
  weeks: SimulatedWeek[]
  keyEvents: string[]
  finalStandings: Array<{ rank: number; name: string; record?: string; points?: number }>
  formatSpecific: Record<string, unknown>
  simulatedAt: string
}

interface SimulationReportModalProps {
  report: SimulationReport
  onClose: () => void
}

function formatLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function SimulationReportModal({ report, onClose }: SimulationReportModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative flex w-full max-w-3xl max-h-[90vh] flex-col rounded-2xl border border-amber-400/20 bg-[#0a1628] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Simulation Report</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">
            <X className="h-5 w-5 text-white/60" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Summary */}
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
            <div className="flex items-center gap-3 mb-3">
              <Trophy className="h-8 w-8 text-amber-400" />
              <div>
                <div className="text-xl font-bold text-amber-100">{report.champion ?? 'No champion'}</div>
                <div className="text-sm text-amber-300/60">
                  {formatLabel(report.leagueVariant ?? report.leagueType)} · {report.sport} · {report.playerCount} teams · {report.weeksSimulated} weeks
                </div>
              </div>
            </div>
            {report.runnerUp && (
              <div className="text-xs text-white/40">Runner-up: {report.runnerUp}</div>
            )}
          </div>

          {/* Key Events */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white/80">Key Events</h3>
            <div className="space-y-1">
              {report.keyEvents.map((event, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-white/60">
                  <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400/60" />
                  <span>{event}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Final Standings */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white/80">Final Standings</h3>
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 text-white/50">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Team</th>
                    {report.finalStandings[0]?.record && <th className="px-3 py-2 text-left">Record</th>}
                    {report.finalStandings[0]?.points != null && <th className="px-3 py-2 text-right">Points</th>}
                  </tr>
                </thead>
                <tbody>
                  {report.finalStandings.slice(0, 20).map((s) => (
                    <tr key={s.rank} className={`border-t border-white/5 ${s.rank === 1 ? 'bg-amber-400/5' : ''}`}>
                      <td className="px-3 py-1.5 text-white/40">{s.rank}</td>
                      <td className="px-3 py-1.5 text-white/80 font-medium">
                        {s.rank === 1 && <Trophy className="inline h-3 w-3 text-amber-400 mr-1" />}
                        {s.name}
                      </td>
                      {s.record != null && <td className="px-3 py-1.5 text-white/50">{s.record}</td>}
                      {s.points != null && <td className="px-3 py-1.5 text-right text-white/50">{s.points}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Week-by-Week (collapsible) */}
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-white/80 mb-2">
              Week-by-Week Detail ({report.weeks.length} weeks)
            </summary>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {report.weeks.map((w) => (
                <div key={w.week} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-white/50">WEEK {w.week}</span>
                    {w.eliminated && (
                      <span className="flex items-center gap-1 text-xs text-red-400/80">
                        <Skull className="h-3 w-3" />{w.eliminated}
                      </span>
                    )}
                    {w.immunityWinner && (
                      <span className="flex items-center gap-1 text-xs text-emerald-400/80">
                        <Shield className="h-3 w-3" />{w.immunityWinner}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {w.events.slice(0, 5).map((e, i) => (
                      <div key={i} className="text-[11px] text-white/40">{e}</div>
                    ))}
                    {w.events.length > 5 && (
                      <div className="text-[11px] text-white/30">+{w.events.length - 5} more events</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>

          {/* Format-Specific Details */}
          {Object.keys(report.formatSpecific).length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-white/80 mb-2">
                Format Details
              </summary>
              <pre className="rounded-lg bg-white/[0.02] border border-white/5 p-3 text-[11px] text-white/40 overflow-x-auto">
                {JSON.stringify(report.formatSpecific, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-5 py-3 flex justify-between items-center">
          <span className="text-xs text-white/30">Simulated {new Date(report.simulatedAt).toLocaleString()}</span>
          <Button onClick={onClose} variant="outline" size="sm">Close</Button>
        </div>
      </div>
    </div>
  )
}
