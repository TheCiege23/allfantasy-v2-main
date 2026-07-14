'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Play, Loader2 } from 'lucide-react'
import type { MockDraftConfig, MockDraftSport, MockLeagueType, MockDraftType, MockScoringFormat, MockPoolType } from '@/lib/mock-draft/types'
import { DEFAULT_MOCK_CONFIG } from '@/lib/mock-draft/types'

const SPORTS: { value: MockDraftSport; label: string }[] = [
  { value: 'NFL', label: 'NFL' },
  { value: 'NHL', label: 'NHL' },
  { value: 'NBA', label: 'NBA' },
  { value: 'MLB', label: 'MLB' },
  { value: 'NCAAB', label: 'NCAA Basketball' },
  { value: 'NCAAF', label: 'NCAA Football' },
  { value: 'SOCCER', label: 'Soccer' },
]

const LEAGUE_TYPES: { value: MockLeagueType; label: string }[] = [
  { value: 'redraft', label: 'Redraft' },
  { value: 'dynasty', label: 'Dynasty' },
]

const DRAFT_TYPES: { value: MockDraftType; label: string }[] = [
  { value: 'snake', label: 'Snake' },
  { value: 'linear', label: 'Linear' },
]

const SCORING_FORMATS: { value: MockScoringFormat; label: string }[] = [
  { value: 'default', label: 'Default (PPR)' },
  { value: 'ppr', label: 'PPR' },
  { value: 'half-ppr', label: 'Half PPR' },
  { value: 'standard', label: 'Standard' },
  { value: 'sf', label: 'Superflex' },
  { value: 'tep', label: 'TE Premium' },
]

const TIMER_OPTIONS = [
  { value: 0, label: 'No timer' },
  { value: 30, label: '30 sec' },
  { value: 60, label: '60 sec' },
  { value: 90, label: '90 sec' },
  { value: 120, label: '2 min' },
]

const POOL_OPTIONS: { value: MockPoolType; label: string }[] = [
  { value: 'all', label: 'All players' },
  { value: 'vets', label: 'Vets only' },
  { value: 'rookies', label: 'Rookies only' },
]

const ROOM_MODE_OPTIONS = [
  { value: 'solo', label: 'Solo (you + CPU)' },
  { value: 'mixed', label: 'Mixed (human + CPU)' },
  { value: 'linked_public', label: 'Linked public (invite humans)' },
  { value: 'cpu_only', label: 'CPU-only simulation room' },
]

export interface MockDraftSetupProps {
  /** Initial config (e.g. from league) */
  initialConfig?: Partial<MockDraftConfig>
  /** Leagues for optional "use league" prefill */
  leagueOptions?: Array< { id: string; name: string; leagueSize?: number; isDynasty?: boolean; scoring?: string | null; sport?: string } >
  onStart: (config: MockDraftConfig) => void
  loading?: boolean
}

export function MockDraftSetup({
  initialConfig,
  leagueOptions = [],
  onStart,
  loading = false,
}: MockDraftSetupProps) {
  const [sport, setSport] = useState<MockDraftSport>(initialConfig?.sport ?? DEFAULT_MOCK_CONFIG.sport)
  const [leagueType, setLeagueType] = useState<MockLeagueType>(initialConfig?.leagueType ?? DEFAULT_MOCK_CONFIG.leagueType)
  const [draftType, setDraftType] = useState<MockDraftType>(initialConfig?.draftType ?? DEFAULT_MOCK_CONFIG.draftType)
  const [numTeams, setNumTeams] = useState(initialConfig?.numTeams ?? DEFAULT_MOCK_CONFIG.numTeams)
  const [scoringFormat, setScoringFormat] = useState<MockScoringFormat>(initialConfig?.scoringFormat ?? DEFAULT_MOCK_CONFIG.scoringFormat)
  const [timerSeconds, setTimerSeconds] = useState(initialConfig?.timerSeconds ?? DEFAULT_MOCK_CONFIG.timerSeconds)
  const [aiEnabled, setAiEnabled] = useState(initialConfig?.aiEnabled ?? DEFAULT_MOCK_CONFIG.aiEnabled)
  const [rounds, setRounds] = useState(initialConfig?.rounds ?? DEFAULT_MOCK_CONFIG.rounds)
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(initialConfig?.leagueId ?? null)
  const [poolType, setPoolType] = useState<MockPoolType>(initialConfig?.poolType ?? 'all')
  const [rosterSize, setRosterSize] = useState(initialConfig?.rosterSize ?? 16)
  const [roomMode, setRoomMode] = useState<MockDraftConfig['roomMode']>(initialConfig?.roomMode ?? 'solo')
  const [humanTeams, setHumanTeams] = useState(initialConfig?.humanTeams ?? 1)

  const handleUseLeague = (leagueId: string) => {
    if (leagueId === 'none') {
      setSelectedLeagueId(null)
      return
    }
    const league = leagueOptions.find((l) => l.id === leagueId)
    if (league) {
      setSelectedLeagueId(league.id)
      setNumTeams(league.leagueSize ?? 12)
      setLeagueType(league.isDynasty ? 'dynasty' : 'redraft')
      if (league.scoring) setScoringFormat((league.scoring.toLowerCase().replace(/\s+/g, '-') as MockScoringFormat) || 'default')
      if (league.sport) setSport((league.sport.toUpperCase() as MockDraftSport) || 'NFL')
    }
  }

  const handleStart = () => {
    const clampedHumanTeams = Math.min(numTeams, Math.max(1, Number(humanTeams) || 1))
    const slotConfig =
      roomMode === 'cpu_only'
        ? Array.from({ length: numTeams }, (_, idx) => ({
            slot: idx + 1,
            type: 'cpu' as const,
            displayName: `CPU ${idx + 1}`,
            userId: null,
          }))
        : roomMode === 'linked_public'
          ? Array.from({ length: numTeams }, (_, idx) => ({
              slot: idx + 1,
              type: 'human' as const,
              displayName: idx === 0 ? 'Host' : `Open Slot ${idx + 1}`,
              userId: null,
            }))
          : roomMode === 'mixed'
            ? Array.from({ length: numTeams }, (_, idx) => {
                const slot = idx + 1
                if (slot <= clampedHumanTeams) {
                  return {
                    slot,
                    type: 'human' as const,
                    displayName: slot === 1 ? 'Host' : `Open Slot ${slot}`,
                    userId: null,
                  }
                }
                return {
                  slot,
                  type: 'cpu' as const,
                  displayName: `CPU ${slot}`,
                  userId: null,
                }
              })
            : Array.from({ length: numTeams }, (_, idx) => ({
                slot: idx + 1,
                type: idx === 0 ? ('human' as const) : ('cpu' as const),
                displayName: idx === 0 ? 'Host' : `CPU ${idx + 1}`,
                userId: null,
              }))

    onStart({
      sport,
      leagueType,
      draftType,
      numTeams,
      scoringFormat,
      timerSeconds,
      aiEnabled,
      rounds,
      leagueId: selectedLeagueId || null,
      poolType,
      rosterSize,
      roomMode,
      humanTeams: clampedHumanTeams,
      slotConfig,
    })
  }

  return (
    <div className="rounded-2xl border border-white/12 bg-black/25 p-6 text-sm text-white/90" data-testid="mock-draft-setup">
      <h2 className="mb-4 text-lg font-semibold text-white">Mock Draft Setup</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-white/80">Sport</Label>
          <Select value={sport} onValueChange={(v) => setSport(v as MockDraftSport)}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white" data-testid="mock-draft-setup-sport-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/80">League type</Label>
          <Select value={leagueType} onValueChange={(v) => setLeagueType(v as MockLeagueType)}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAGUE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/80">Draft type</Label>
          <Select value={draftType} onValueChange={(v) => setDraftType(v as MockDraftType)}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRAFT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/80">Teams</Label>
          <Select value={String(numTeams)} onValueChange={(v) => setNumTeams(Number(v))}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[8, 10, 12, 14, 16].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/80">Scoring</Label>
          <Select value={scoringFormat} onValueChange={(v) => setScoringFormat(v as MockScoringFormat)}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCORING_FORMATS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/80">Timer (per pick)</Label>
          <Select value={String(timerSeconds)} onValueChange={(v) => setTimerSeconds(Number(v))}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/80">Rounds</Label>
          <Select value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[12, 15, 18, 20, 22].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {leagueOptions.length > 0 && (
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-white/80">Use league settings (optional)</Label>
            <Select value={selectedLeagueId || 'none'} onValueChange={handleUseLeague}>
              <SelectTrigger className="border-white/15 bg-black/40 text-white">
                <SelectValue placeholder="Solo mock (no league)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Solo mock (no league)</SelectItem>
                {leagueOptions.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Label className="text-white/80">Player pool</Label>
          <Select value={poolType} onValueChange={(v) => setPoolType(v as MockPoolType)}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POOL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-white/80">Room mode</Label>
          <Select value={roomMode || 'solo'} onValueChange={(v) => setRoomMode(v as MockDraftConfig['roomMode'])}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white" data-testid="mock-draft-room-mode-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROOM_MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(roomMode === 'mixed' || roomMode === 'linked_public') && (
          <div className="space-y-2">
            <Label className="text-white/80">Human teams</Label>
            <Select value={String(humanTeams)} onValueChange={(v) => setHumanTeams(Number(v))}>
              <SelectTrigger className="border-white/15 bg-black/40 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: numTeams }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label className="text-white/80">Roster size</Label>
          <Select value={String(rosterSize)} onValueChange={(v) => setRosterSize(Number(v))}>
            <SelectTrigger className="border-white/15 bg-black/40 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[12, 14, 16, 18, 20].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <input
            type="checkbox"
            id="mock-ai-toggle"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-black/40 text-cyan-500"
          />
          <Label htmlFor="mock-ai-toggle" className="cursor-pointer text-white/80">
            Enable AI Draft Assistant (suggestions only)
          </Label>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button
          onClick={handleStart}
          disabled={loading}
          data-testid="mock-draft-setup-start"
          className="bg-cyan-600 text-white hover:bg-cyan-500"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Start mock draft
        </Button>
      </div>
    </div>
  )
}
