/**
 * Match AI ADP snapshot rows to draft pool players.
 * Snapshots use the same key shape as picks (name|position|team, lowercased) but team can be
 * missing on one side or abbreviated differently — try strict, then team-less strict, then name+position.
 */

export type AiAdpSnapshotRow = {
  playerName: string
  position: string
  team: string | null
  adp: number
  sampleSize: number
  lowSample?: boolean
}

type AiAdpMatchData = { adp: number; sampleSize: number; lowSample?: boolean }

type AiAdpLookupMaps = {
  strict: Map<string, AiAdpMatchData>
  loose: Map<string, AiAdpMatchData>
}

function rowData(e: AiAdpSnapshotRow): { adp: number; sampleSize: number; lowSample?: boolean } {
  return { adp: e.adp, sampleSize: e.sampleSize, lowSample: e.lowSample }
}

/** Build maps once per snapshot; reuse for every player row. */
export function buildAiAdpLookupMaps(entries: AiAdpSnapshotRow[] | null | undefined): AiAdpLookupMaps {
  const strict = new Map<string, ReturnType<typeof rowData>>()
  const loose = new Map<string, ReturnType<typeof rowData>>()
  if (!entries?.length) return { strict, loose }

  for (const e of entries) {
    const en = (e.playerName || '').trim().toLowerCase()
    const ep = (e.position || '').trim().toLowerCase()
    const et = (e.team || '').trim().toLowerCase()
    const data = rowData(e)
    strict.set(`${en}|${ep}|${et}`, data)
    const lk = `${en}|${ep}`
    if (!loose.has(lk)) loose.set(lk, data)
  }
  return { strict, loose }
}

export function lookupAiAdpMatch(
  maps: AiAdpLookupMaps,
  name: string,
  position: string,
  team: string | null | undefined
): AiAdpMatchData | null {
  const n = (name || '').trim().toLowerCase()
  const p = (position || '').trim().toLowerCase()
  const t = (team || '').trim().toLowerCase()

  let hit = maps.strict.get(`${n}|${p}|${t}`)
  if (hit) return hit

  // Pool has team, snapshot row had no team (or vice versa): third segment empty.
  if (t) {
    hit = maps.strict.get(`${n}|${p}|`)
    if (hit) return hit
  }

  return maps.loose.get(`${n}|${p}`) ?? null
}

/** For APIs that only accept a flat Record (e.g. recommendation `aiAdpByKey`). */
export function expandAiAdpKeysForLookup(entries: AiAdpSnapshotRow[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!entries?.length) return out
  for (const e of entries) {
    const n = (e.playerName || '').trim().toLowerCase()
    const p = (e.position || '').trim().toLowerCase()
    const t = (e.team || '').trim().toLowerCase()
    const v = e.adp
    out[`${n}|${p}|${t}`] = v
    if (out[`${n}|${p}|`] === undefined) out[`${n}|${p}|`] = v
    if (out[`${n}|${p}`] === undefined) out[`${n}|${p}`] = v
  }
  return out
}
