/** The provider appends the current request as a new turn; do not also send it as history. */
export function priorConversationTurns<T extends { role: 'user' | 'assistant'; content: string }>(
  turns: T[], currentMessage: string, limit = 10,
): T[] {
  const prior = turns.slice(-limit)
  if (prior.at(-1)?.role === 'user' && prior.at(-1)?.content.trim() === currentMessage.trim()) prior.pop()
  return prior
}
