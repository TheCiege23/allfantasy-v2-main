/**
 * A tiny in-memory stand-in for the two prospect delegates — enough of Prisma's `findMany` / `upsert`
 * / `updateMany` for the where shapes lib/dynasty-prospects uses. Every call is recorded so a test
 * can assert that NO query ran.
 */

type Row = Record<string, any>

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'in' in v) return (v.in as unknown[]).includes(row[k])
    return row[k] === v
  })
}

function pick(row: Row, select?: Row): Row {
  if (!select) return { ...row }
  return Object.fromEntries(Object.keys(select).map((k) => [k, row[k] ?? null]))
}

function delegate(uniqueName: string, uniqueFields: string[], calls: string[], table: string) {
  const rows: Row[] = []
  let seq = 0
  return {
    rows,
    findMany: async (args: { where: Row; select?: Row; orderBy?: Row[]; take?: number }) => {
      calls.push(`${table}.findMany`)
      let out = rows.filter((r) => matches(r, args.where))
      if (args.orderBy) {
        out = [...out].sort((a, b) => {
          for (const o of args.orderBy!) {
            const [k, spec] = Object.entries(o)[0]
            const dir = typeof spec === 'string' ? spec : spec.sort
            const av = a[k]
            const bv = b[k]
            if (av === bv) continue
            if (av == null) return 1
            if (bv == null) return -1
            return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1)
          }
          return 0
        })
      }
      if (args.take !== undefined) out = out.slice(0, args.take)
      return out.map((r) => pick(r, args.select))
    },
    upsert: async (args: { where: Row; create: Row; update: Row }) => {
      calls.push(`${table}.upsert`)
      const key = args.where[uniqueName]
      const found = rows.find((r) => uniqueFields.every((f) => r[f] === key[f]))
      if (found) {
        Object.assign(found, args.update, { updatedAt: new Date() })
        return found
      }
      const row = { id: `${table}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...args.create }
      rows.push(row)
      return row
    },
    updateMany: async (args: { where: Row; data: Row }) => {
      calls.push(`${table}.updateMany`)
      const hit = rows.filter((r) => matches(r, args.where))
      for (const r of hit) Object.assign(r, args.data)
      return { count: hit.length }
    },
  }
}

export function fakeProspectDb() {
  const calls: string[] = []
  const prospectPlayer = delegate('sport_source_sourcePlayerId', ['sport', 'source', 'sourcePlayerId'], calls, 'prospectPlayer')
  const rookieEligibilityRecord = delegate(
    'sport_season_playerKey_source',
    ['sport', 'season', 'playerKey', 'source'],
    calls,
    'rookieEligibilityRecord',
  )
  return { calls, prospectPlayer, rookieEligibilityRecord, db: { prospectPlayer, rookieEligibilityRecord } as any }
}
