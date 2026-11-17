/**
 * Big Brother minigame registry — deterministic pull themed per phase.
 * Outcomes are never AI-decided; this only generates the prompt/theme.
 * Use BigBrotherChallengeEngine to resolve the winner.
 */

type BbMinigameKind = 'hoh' | 'veto'

interface BbMinigameTemplate {
  id: string
  kind: BbMinigameKind
  title: string
  prompt: string
}

const HOH_MINIGAMES: BbMinigameTemplate[] = [
  {
    id: 'hoh_quiz_draft_history',
    kind: 'hoh',
    title: 'Draft Day Recall',
    prompt: 'Highest combined draft-pick order for starters this week wins HOH.',
  },
  {
    id: 'hoh_peak_player',
    kind: 'hoh',
    title: 'Peak Player',
    prompt: 'Whose single highest-scoring starter tops the house? Winner wears the key.',
  },
  {
    id: 'hoh_bench_gambit',
    kind: 'hoh',
    title: 'Bench Gambit',
    prompt: 'Best bench-point total among eligible houseguests takes HOH.',
  },
  {
    id: 'hoh_margin_master',
    kind: 'hoh',
    title: 'Margin Master',
    prompt: 'Smallest win/loss margin this week wins — closest to the bubble takes the crown.',
  },
]

const VETO_MINIGAMES: BbMinigameTemplate[] = [
  {
    id: 'veto_dual_threat',
    kind: 'veto',
    title: 'Dual Threat',
    prompt: 'Best combined score across FLEX slots wins the POV.',
  },
  {
    id: 'veto_clutch_play',
    kind: 'veto',
    title: 'Clutch Play',
    prompt: 'Highest Monday/Sunday-night score among competitors wins the veto.',
  },
  {
    id: 'veto_projection_gap',
    kind: 'veto',
    title: 'Projection Gap',
    prompt: 'Largest over-projection delta among competitors takes the POV.',
  },
]

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h) || 1
}

/**
 * Deterministic minigame pull — same leagueId+week+kind always returns the
 * same template. Callers can safely reveal this to houseguests: the outcome
 * is still decided by the scoring-based challenge engine.
 */
export function pullMinigame(leagueId: string, week: number, kind: BbMinigameKind): BbMinigameTemplate {
  const pool = kind === 'hoh' ? HOH_MINIGAMES : VETO_MINIGAMES
  const seed = hashSeed(`${leagueId}:${week}:${kind}`)
  return pool[seed % pool.length]!
}
