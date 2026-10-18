'use client'

import { useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { LeagueCreateStepProps } from '../types'

const TRIBE_FORMATIONS = ['schoolyard', 'random', 'manual'] as const
const TRIBE_NAMING_MODES = ['auto', 'custom'] as const
const MERGE_TRIGGERS = ['week', 'players_remaining'] as const
const JURY_STARTS = ['post_merge_vote_1', 'final_9', 'final_7'] as const
const TIE_RULES = ['revote_then_rocks', 'revote_then_tiebreaker', 'commissioner'] as const
const REVEAL_MODES = ['dramatic_sequential', 'simultaneous', 'commissioner'] as const
const CHALLENGE_MODES = ['auto', 'hybrid', 'commissioner'] as const

const TRIBE_LABEL: Record<string, string> = {
  schoolyard: 'Schoolyard Pick',
  random: 'Auto-Generate',
  manual: 'Manual Assign',
}

const NAMING_LABEL: Record<string, string> = {
  auto: 'Auto Names',
  custom: 'Custom Names',
}

function recommendedTribeSplit(players: number): string {
  if (players === 20) return '4 tribes of 5'
  if (players === 16) return '4 tribes of 4'
  return '4 tribes with commissioner-balanced extras'
}

export function SurvivorSetupStep({ state, setState }: LeagueCreateStepProps) {
  const mergeTriggerRef = useRef(state.survivorMergeTrigger)
  useEffect(() => {
    mergeTriggerRef.current = state.survivorMergeTrigger
  }, [state.survivorMergeTrigger])

  const tribeSize = state.survivorTribeCount > 0
    ? Math.floor(state.survivorPlayerCount / state.survivorTribeCount)
    : 0

  return (
    <div className="space-y-5">
      {/* Section: Commissioner Participation */}
      <div>
        <div className="mb-3 text-sm font-medium text-white/80">Commissioner Role</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setState((c) => ({ ...c, survivorCommissionerPlays: false }))}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              !state.survivorCommissionerPlays
                ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
            }`}
          >
            <div className="text-sm font-medium">Spectator</div>
            <div className="text-xs text-white/40 mt-1">Manage the league without playing. Full access to idol info, votes, and overrides.</div>
          </button>
          <button
            type="button"
            onClick={() => setState((c) => ({ ...c, survivorCommissionerPlays: true }))}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              state.survivorCommissionerPlays
                ? 'border-amber-300/60 bg-amber-300/10 text-white'
                : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
            }`}
          >
            <div className="text-sm font-medium">Participating</div>
            <div className="text-xs text-white/40 mt-1">Play as a regular manager. Blind mode — no hidden info. System handles votes autonomously.</div>
          </button>
        </div>
      </div>

      {/* Section: Players & Tribes */}
      <div>
        <div className="mb-3 text-sm font-medium text-white/80">Players &amp; Tribes</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-medium text-white/60">Player Count</label>
            <Input
              type="number"
              min={16}
              max={20}
              value={state.survivorPlayerCount}
              onChange={(e) =>
                setState((c) => {
                  const count = Math.min(20, Math.max(16, Number(e.target.value) || 20))
                  return { ...c, survivorPlayerCount: count, survivorTribeCount: 4 }
                })
              }
            />
            <div className="mt-1 text-xs text-white/40">
              Recommended: {recommendedTribeSplit(state.survivorPlayerCount)}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-white/60">Tribe Count</label>
            <Input
              type="number"
              min={2}
              max={5}
              value={state.survivorTribeCount}
              onChange={(e) =>
                setState((c) => ({
                  ...c,
                  survivorTribeCount: Math.min(5, Math.max(2, Number(e.target.value) || 4)),
                }))
              }
            />
            <div className="mt-1 text-xs text-white/40">
              {tribeSize} players per tribe
            </div>
          </div>
        </div>
      </div>

      {/* Section: Tribe Formation */}
      <div>
        <label className="mb-2 block text-xs font-medium text-white/60">Tribe Formation</label>
        <div className="grid gap-3 sm:grid-cols-3">
          {TRIBE_FORMATIONS.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setState((c) => ({ ...c, survivorTribeFormation: mode }))}
              className={`rounded-2xl border px-4 py-3 text-sm transition ${
                state.survivorTribeFormation === mode
                  ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
              }`}
            >
              {TRIBE_LABEL[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Section: Tribe Naming */}
      <div>
        <label className="mb-2 block text-xs font-medium text-white/60">Tribe Names &amp; Logos</label>
        <div className="grid gap-3 sm:grid-cols-3">
          {TRIBE_NAMING_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setState((c) => ({ ...c, survivorTribeNaming: mode }))}
              className={`rounded-2xl border px-4 py-3 text-sm transition ${
                state.survivorTribeNaming === mode
                  ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
              }`}
            >
              {NAMING_LABEL[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Section: Merge & Jury */}
      <div>
        <div className="mb-3 text-sm font-medium text-white/80">Merge &amp; Jury</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-medium text-white/60">Merge Trigger</label>
            <div className="grid gap-2 grid-cols-2">
              {MERGE_TRIGGERS.map((trigger) => (
                <button
                  key={trigger}
                  type="button"
                  onClick={() => {
                    mergeTriggerRef.current = trigger
                    setState((c) => ({ ...c, survivorMergeTrigger: trigger }))
                  }}
                  className={`rounded-2xl border px-3 py-2 text-xs transition ${
                    state.survivorMergeTrigger === trigger
                      ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
                  }`}
                >
                  {trigger === 'players_remaining' ? 'At Player Count' : 'At Week'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-white/60">
              {state.survivorMergeTrigger === 'week' ? 'Merge at Week' : 'Merge at Players Remaining'}
            </label>
            <Input
              type="number"
              min={state.survivorMergeTrigger === 'week' ? 4 : 6}
              max={state.survivorMergeTrigger === 'week' ? 14 : state.survivorPlayerCount}
              value={state.survivorMergeTrigger === 'week' ? state.survivorMergeWeek : state.survivorMergeAtCount}
              onChange={(e) =>
                setState((c) => {
                  const activeTrigger = mergeTriggerRef.current
                  return {
                    ...c,
                    ...(activeTrigger === 'week'
                      ? { survivorMergeWeek: Number(e.target.value) || 8 }
                      : { survivorMergeAtCount: Number(e.target.value) || 10 }),
                  }
                })
              }
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-2 block text-xs font-medium text-white/60">Jury Starts</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {JURY_STARTS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setState((c) => ({ ...c, survivorJuryStart: opt }))}
                className={`rounded-2xl border px-3 py-2 text-xs transition ${
                  state.survivorJuryStart === opt
                    ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                    : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
                }`}
              >
                {opt.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Section: Idols & Powers */}
      <div>
        <div className="mb-3 text-sm font-medium text-white/80">Idols &amp; Powers</div>
        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm text-white/75">
            <input
              type="checkbox"
              checked={state.survivorIdolsEnabled}
              onChange={(e) => setState((c) => ({ ...c, survivorIdolsEnabled: e.target.checked }))}
              className="rounded border-white/20"
            />
            Enable Idols
          </label>
          <label className="flex items-center gap-2 text-sm text-white/75">
            <input
              type="checkbox"
              checked={state.survivorIdolsTradable}
              onChange={(e) => setState((c) => ({ ...c, survivorIdolsTradable: e.target.checked }))}
              className="rounded border-white/20"
              disabled={!state.survivorIdolsEnabled}
            />
            Tradable
          </label>
          <label className="flex items-center gap-2 text-sm text-white/75">
            <input
              type="checkbox"
              checked={state.survivorIdolsExpireAtMerge}
              onChange={(e) => setState((c) => ({ ...c, survivorIdolsExpireAtMerge: e.target.checked }))}
              className="rounded border-white/20"
              disabled={!state.survivorIdolsEnabled}
            />
            Expire at Merge
          </label>
        </div>
        {state.survivorIdolsEnabled && (
          <div className="w-40">
            <label className="mb-2 block text-xs font-medium text-white/60">Total Idol Count</label>
            <select
              value={[6, 7, 8].includes(state.survivorIdolCount) ? state.survivorIdolCount : 7}
              onChange={(e) => setState((c) => ({ ...c, survivorIdolCount: Number(e.target.value) }))}
              className="h-10 w-full rounded-md border border-white/15 bg-transparent px-2 text-sm text-white"
            >
              {[6, 7, 8].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Section: Exile Island */}
      <div>
        <div className="mb-3 text-sm font-medium text-white/80">Exile Island</div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-white/75">
            <input
              type="checkbox"
              checked={state.survivorExileEnabled}
              onChange={(e) => setState((c) => ({ ...c, survivorExileEnabled: e.target.checked }))}
              className="rounded border-white/20"
            />
            Enable Exile Island
          </label>
          {state.survivorExileEnabled && (
            <>
              <label className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={state.survivorTokenEnabled}
                  onChange={(e) => setState((c) => ({ ...c, survivorTokenEnabled: e.target.checked }))}
                  className="rounded border-white/20"
                />
                Token Pool
              </label>
              <label className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={state.survivorBossResetEnabled}
                  onChange={(e) => setState((c) => ({ ...c, survivorBossResetEnabled: e.target.checked }))}
                  className="rounded border-white/20"
                />
                Boss Reset
              </label>
            </>
          )}
        </div>
      </div>

      {/* Section: Tribal Council Rules */}
      <div>
        <div className="mb-3 text-sm font-medium text-white/80">Tribal Council Rules</div>
        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm text-white/75">
            <input
              type="checkbox"
              checked={state.survivorSelfVoteAllowed}
              onChange={(e) => setState((c) => ({ ...c, survivorSelfVoteAllowed: e.target.checked }))}
              className="rounded border-white/20"
            />
            Allow Self-Voting
          </label>
          <label className="flex items-center gap-2 text-sm text-white/75">
            <input
              type="checkbox"
              checked={state.survivorRocksEnabled}
              onChange={(e) => setState((c) => ({ ...c, survivorRocksEnabled: e.target.checked }))}
              className="rounded border-white/20"
            />
            Go to Rocks
          </label>
        </div>

        <label className="mb-2 block text-xs font-medium text-white/60">Tiebreaker Mode</label>
        <div className="grid gap-2 sm:grid-cols-4">
          {TIE_RULES.map((rule) => (
            <button
              key={rule}
              type="button"
              onClick={() => setState((c) => ({ ...c, survivorTieRule: rule }))}
              className={`rounded-2xl border px-3 py-2 text-xs transition ${
                state.survivorTieRule === rule
                  ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
              }`}
            >
              {rule.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Section: Vote Reveal & Challenges */}
      <div>
        <div className="mb-3 text-sm font-medium text-white/80">Presentation &amp; Challenges</div>
        <label className="mb-2 block text-xs font-medium text-white/60">Vote Reveal Mode</label>
        <div className="grid gap-2 sm:grid-cols-4 mb-3">
          {REVEAL_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setState((c) => ({ ...c, survivorRevealMode: mode }))}
              className={`rounded-2xl border px-3 py-2 text-xs transition ${
                state.survivorRevealMode === mode
                  ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
              }`}
            >
              {mode.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <label className="mb-2 block text-xs font-medium text-white/60">Challenge Automation</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {CHALLENGE_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setState((c) => ({ ...c, survivorChallengeMode: mode }))}
              className={`rounded-2xl border px-3 py-2 text-xs transition ${
                state.survivorChallengeMode === mode
                  ? 'border-cyan-300/60 bg-cyan-300/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/20'
              }`}
            >
              {mode.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
