import { NextRequest } from 'next/server'
import { proxyToExisting } from '@/lib/api/proxy-adapter'

export async function POST(req: NextRequest, { params }: { params: { leagueId: string } }) {
  return proxyToExisting(req, {
    targetPath: '/api/trades/analyze',
    query: { leagueId: params.leagueId },
  })
}
