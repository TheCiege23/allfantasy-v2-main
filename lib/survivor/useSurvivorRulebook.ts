'use client'

import { useEffect, useState } from 'react'
import type { SurvivorRulesSection } from './survivorRulesAnswers'

/** The league's rulebook from /api/survivor/rules. Null while loading or when it cannot be read. */
export function useSurvivorRulebook(leagueId: string, enabled = true): { sections: SurvivorRulesSection[] | null; failed: boolean } {
  const [sections, setSections] = useState<SurvivorRulesSection[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!leagueId || !enabled) return
    let live = true
    fetch(`/api/survivor/rules?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('rules'))))
      .then((json: { sections?: SurvivorRulesSection[] }) => { if (live) setSections(Array.isArray(json.sections) ? json.sections : []) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [leagueId, enabled])
  return { sections, failed }
}
