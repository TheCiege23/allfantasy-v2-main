/**
 * GET /api/leagues/[leagueId]/survivor/token-shop
 * The token shop catalog: only items the commissioner has put on sale, at their prices
 * (`League.settings.survivorSideGames.tokenShopItems`), plus the caller's own token balance.
 *
 * 🛑 THE SHOP USED TO LIST NOTHING (2026-10-27): `buy_clue` was charged for and never delivered,
 * and those tokens are the same balance a manager on Exile needs to come back. Every item now sold
 * is a reward-API prize (an advantage, a free trade, a steal blocker, FAAB, points), bought through
 * POST /api/survivor/side-games `shop_buy`, which takes the tokens and delivers in the same request
 * (or, for a buyer still on Exile, the moment they are back on the island). Defaults sell nothing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { readSurvivorSideGameSettings } from '@/lib/survivor/survivorSideGameSettings'

export const dynamic = 'force-dynamic'

const LABELS: Record<string, { en: string; es: string }> = {
  extra_vote: { en: 'Extra Vote', es: 'Voto extra' },
  vote_steal: { en: 'Vote Steal', es: 'Robo de voto' },
  vote_shield: { en: 'Vote Shield', es: 'Escudo de voto' },
  free_trade_token: { en: 'Free Trade', es: 'Intercambio libre' },
  steal_blocker: { en: 'Steal Blocker', es: 'Bloqueador de robos' },
  faab: { en: 'FAAB', es: 'FAAB' },
  score_bonus: { en: 'Bonus points', es: 'Puntos extra' },
}

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status ?? 403 })

  const [player, league] = await Promise.all([
    prisma.survivorPlayer.findFirst({ where: { leagueId, userId }, select: { tokenBalance: true } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } }),
  ])
  const settings = readSurvivorSideGameSettings(league?.settings)
  const es = String(league?.language ?? '').toLowerCase().startsWith('es')
  const catalog = settings.tokenShopEnabled
    ? settings.tokenShopItems.filter((item) => item.enabled).map((item) => {
      const label = LABELS[item.kind === 'advantage' ? item.powerType : item.kind] ?? { en: item.id, es: item.id }
      const amount = item.kind === 'faab' ? ` $${item.amount}` : item.kind === 'score_bonus' ? ` +${item.amount}` : ''
      return { id: item.id, kind: item.kind, label: `${es ? label.es : label.en}${amount}`, cost: item.cost, status: 'available' as const }
    })
    : []

  return NextResponse.json({
    catalog,
    balance: player?.tokenBalance ?? 0,
    shopStatus: settings.tokenShopEnabled && catalog.length ? 'open' : 'closed',
    shopNote: settings.tokenShopEnabled && catalog.length
      ? (es ? 'Gasta tus fichas en ventajas. Comprar las descuenta de las fichas que necesitas para volver.' : 'Spend tokens on advantages. Buying spends tokens you may need to return.')
      : (es ? 'La tienda de fichas está cerrada.' : 'The token shop is closed.'),
  })
}
