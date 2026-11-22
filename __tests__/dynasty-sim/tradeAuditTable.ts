import type { Prisma } from '@prisma/client'
import type { InMemoryPrisma } from '../redraft-season-simulation/inMemoryPrisma'

/** Support only the SQL used by tradeValueAudit, so the real scan can persist and read its evidence. */
export function withTradeAuditTable(db: InMemoryPrisma): InMemoryPrisma {
  const audits = new Map<string, {
    league_id: string
    trade_key: string
    side_a_team_id: string
    side_b_team_id: string
    side_a_name: string
    side_b_name: string
    side_a_gave: unknown
    side_b_gave: unknown
    side_a_value: number
    side_b_value: number
    gap_pct: number
    basis: string
    completed_at: Date | null
  }>()

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === '$queryRaw') {
        return async (query: TemplateStringsArray, ...args: unknown[]) => {
          const sql = query.join('?')
          if (sql.includes("table_name = 'trade_value_audits'")) return [{ n: 1 }]
          if (!sql.includes('FROM trade_value_audits')) return target.$queryRaw(query, ...args)

          const filter = args[0] as Prisma.Sql
          const [leagueId, ...filters] = filter.values
          const since = filters.find((value): value is Date => value instanceof Date)
          const tradeKeys = filters.filter((value): value is string => typeof value === 'string')
          return [...audits.values()]
            .filter(row => row.league_id === leagueId)
            .filter(row => !since || !row.completed_at || row.completed_at >= since)
            .filter(row => !tradeKeys.length || tradeKeys.includes(row.trade_key))
            .sort((a, b) => (b.completed_at?.getTime() ?? 0) - (a.completed_at?.getTime() ?? 0))
        }
      }
      if (prop === '$executeRaw') {
        return async (query: TemplateStringsArray, ...args: unknown[]) => {
          if (!query.join('?').includes('INSERT INTO trade_value_audits')) return target.$executeRaw(query, ...args)

          const [, leagueId, tradeKey, , sideA, sideB, nameA, nameB, assetsA, assetsB, valueA, valueB, gap, basis, completedAt] = args
          const key = JSON.stringify([leagueId, tradeKey])
          if (audits.has(key)) return 0
          audits.set(key, {
            league_id: String(leagueId),
            trade_key: String(tradeKey),
            side_a_team_id: String(sideA),
            side_b_team_id: String(sideB),
            side_a_name: String(nameA),
            side_b_name: String(nameB),
            side_a_gave: JSON.parse(String(assetsA)),
            side_b_gave: JSON.parse(String(assetsB)),
            side_a_value: Number(valueA),
            side_b_value: Number(valueB),
            gap_pct: Number(gap),
            basis: String(basis),
            completed_at: completedAt instanceof Date ? completedAt : null,
          })
          return 1
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
