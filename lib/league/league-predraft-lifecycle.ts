/** Lifecycle states treated as “early setup / predraft” for member-first-run UX. */
const PREDraft_LIFECYCLE_STATES = new Set(['pre_draft', 'predraft', 'draft_setup', 'setup'])

export function isLeaguePredraftLifecycle(lifecycleState: string | null | undefined): boolean {
  return PREDraft_LIFECYCLE_STATES.has(String(lifecycleState ?? '').trim().toLowerCase())
}
