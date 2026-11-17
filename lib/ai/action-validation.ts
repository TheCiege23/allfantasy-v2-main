export type AiActionKind = 'apply_lineup' | 'add_waiver_claim' | 'save_counteroffer'

export function isAiActionSource(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const obj = body as Record<string, unknown>

  if (obj.fromAi === true || obj.aiGenerated === true) return true

  const source = String(obj.actionSource ?? obj.source ?? obj.origin ?? '').toLowerCase()
  if (!source) return false

  return [
    'ai',
    'assistant',
    'ai_handoff',
    'ai-action',
    'copilot',
    'openai',
  ].includes(source)
}

export function validateAiActionExecution(args: {
  body: unknown
  action: AiActionKind
  leagueId?: string | null
}): { ok: true } | { ok: false; status: number; error: string } {
  const obj = args.body && typeof args.body === 'object'
    ? (args.body as Record<string, unknown>)
    : {}

  if (!isAiActionSource(obj)) {
    return { ok: true }
  }

  const validation =
    obj.validation && typeof obj.validation === 'object'
      ? (obj.validation as Record<string, unknown>)
      : null

  const confirmed = Boolean(
    validation?.confirmedByUser === true ||
      validation?.userConfirmed === true ||
      validation?.approved === true
  )

  if (!confirmed) {
    return {
      ok: false,
      status: 422,
      error: 'Chimmy action requires explicit user confirmation before execution.',
    }
  }

  const validationAction = typeof validation?.action === 'string' ? validation.action : null
  if (validationAction && validationAction !== args.action) {
    return {
      ok: false,
      status: 400,
      error: 'Chimmy action validation payload does not match requested action.',
    }
  }

  const validationLeagueId =
    typeof validation?.leagueId === 'string' ? validation.leagueId :
    typeof validation?.league_id === 'string' ? validation.league_id :
    null

  if (args.leagueId && validationLeagueId && validationLeagueId !== args.leagueId) {
    return {
      ok: false,
      status: 400,
      error: 'Chimmy action validation league does not match target league.',
    }
  }

  return { ok: true }
}
