import type { HelpClient } from './types'

function notYetIntegrated() {
  return {
    category: 'upstream_unavailable' as const,
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'help' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Deliberately not "serve the demo catalog as if live" even though that
 * would always technically succeed — per the approved blueprint §5, an
 * honest `upstream_unavailable` placeholder keeps `source: 'live'` meaning
 * one consistent thing (the real backend isn't wired up yet) across all
 * twelve adapter namespaces, rather than letting Help Center's unusually
 * static content quietly redefine what "live" promises.
 */
export const liveHelpClient: HelpClient = {
  async getArticles() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
  async getGlossary() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
}
