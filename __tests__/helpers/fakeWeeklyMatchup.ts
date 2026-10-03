/**
 * An in-memory `prisma.weeklyMatchup` that APPLIES its `where`, for loaders that ask it several
 * different questions.
 *
 * ⚠ WHY NOT A FIXED ANSWER. The rail mocks returned the same rows for every `findMany` and the same
 * seasons for every `groupBy`. That was fine while the rail asked one question of each; once it read
 * a per-week summary and then only the resolved week (2026-10-03), a fixed answer would hand the week
 * summary to the row read and silently test nothing. This applies the filters those reads use —
 * `in`, `gt`, `gte`, `lt`, `lte`, `equals`, plain equality and `OR` — to the fixture rows.
 */
type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false
      continue
    }
    if (key === 'AND') {
      if (!(cond as Where[]).every((w) => matches(row, w))) return false
      continue
    }
    const value = row[key]
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ('in' in c && !(c.in as unknown[]).includes(value)) return false
      if ('equals' in c && value !== c.equals) return false
      if ('gt' in c && !((value as number) > (c.gt as number))) return false
      if ('gte' in c && !((value as number) >= (c.gte as number))) return false
      if ('lt' in c && !((value as number) < (c.lt as number))) return false
      if ('lte' in c && !((value as number) <= (c.lte as number))) return false
      continue
    }
    if (value !== cond) return false
  }
  return true
}

export function fakeWeeklyMatchup(rows: () => Row[]) {
  return {
    findMany: async (args: { where?: Where; select?: Record<string, boolean> } = {}) =>
      rows()
        .filter((r) => matches(r, args.where))
        .map((r) => (args.select ? Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k]])) : { ...r })),
    groupBy: async (args: { by: string[]; where?: Where; _max?: Record<string, boolean> }) => {
      const groups = new Map<string, Row[]>()
      for (const r of rows().filter((x) => matches(x, args.where))) {
        const key = JSON.stringify(args.by.map((k) => r[k]))
        const list = groups.get(key)
        if (list) list.push(r)
        else groups.set(key, [r])
      }
      return [...groups.values()].map((list) => {
        const out: Row = Object.fromEntries(args.by.map((k) => [k, list[0]![k]]))
        if (args._max) {
          out._max = Object.fromEntries(
            Object.keys(args._max).map((k) => [k, Math.max(...list.map((r) => r[k] as number))]),
          )
        }
        return out
      })
    },
  }
}
