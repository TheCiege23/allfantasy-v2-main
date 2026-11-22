/** Client-side draft copilot copy + selection context (live redraft snake room). */

type DraftCopilotStance = 'safer' | 'upside' | 'balanced'

export type DraftCopilotInsight = {
  headline: string
  bullets: string[]
  stance?: DraftCopilotStance
}
