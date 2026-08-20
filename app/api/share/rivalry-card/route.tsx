import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'
import { getImportedLeagueH2H } from '@/lib/league-history/importedFactsH2HService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Shareable rivalry card (1200×630 PNG): all-time record between two managers
 * from the H2H deep sync. Auth-gated generation; shared as an image.
 */

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '??'
}

function ManagerBlock({
  name,
  teamName,
  avatar,
  align,
}: {
  name: string
  teamName: string | null
  avatar: string | null
  align: 'flex-start' | 'flex-end'
}) {
  const avatarUrl = avatar ? `https://sleepercdn.com/avatars/${avatar}` : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, flex: 1 }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" width={110} height={110} style={{ borderRadius: 110, objectFit: 'cover' }} />
      ) : (
        <div
          style={{
            display: 'flex',
            width: 110,
            height: 110,
            borderRadius: 110,
            background: '#262c6a',
            color: '#d5daff',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          {initials(name)}
        </div>
      )}
      <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, color: '#f0f2ff', marginTop: 12 }}>
        {name}
      </div>
      {teamName ? <div style={{ display: 'flex', fontSize: 18, color: '#8b93cf' }}>{teamName}</div> : null}
    </div>
  )
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const aId = req.nextUrl.searchParams?.get('a')?.trim()
  const bId = req.nextUrl.searchParams?.get('b')?.trim()
  if (!leagueId || !aId || !bId) {
    return NextResponse.json({ error: 'Missing leagueId, a or b' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, name: true, platform: true, platformLeagueId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  // Sleeper leagues use the live chain sync; imported leagues (Yahoo/ESPN/…)
  // use the same aggregation over their persisted matchup facts.
  const h2h =
    league.platform === 'sleeper' && league.platformLeagueId
      ? await getLeagueH2H(league.platformLeagueId)
      : await getImportedLeagueH2H(league.id)
  const a = h2h?.managers.find((m) => m.ownerId === aId)
  const b = h2h?.managers.find((m) => m.ownerId === bId)
  if (!h2h || !a || !b) {
    return NextResponse.json({ error: 'Managers not found in the synced history' }, { status: 404 })
  }
  const rivalry = a.byOpponent.find((o) => o.opponentOwnerId === bId) ?? null

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#0b0e2a',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{ display: 'flex', height: 8, width: '100%', background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', padding: '34px 48px', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 42,
                fontWeight: 900,
                fontStyle: 'italic',
                color: '#f0f2ff',
                letterSpacing: 1,
              }}
            >
              RIVALRY RECORD
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#c6cbf5' }}>{league.name}</div>
              <div style={{ display: 'flex', fontSize: 17, color: '#8b93cf' }}>
                {h2h.seasons.length} seasons · every week synced
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', marginTop: 40, flex: 1 }}>
            <ManagerBlock name={a.name} teamName={a.teamName} avatar={a.avatar} align="flex-start" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1.2 }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: 96,
                  fontWeight: 900,
                  fontStyle: 'italic',
                  color: '#f0f2ff',
                  lineHeight: 1,
                }}
              >
                {rivalry ? `${rivalry.wins}-${rivalry.losses}${rivalry.ties > 0 ? `-${rivalry.ties}` : ''}` : '0-0'}
              </div>
              {rivalry ? (
                <div style={{ display: 'flex', fontSize: 20, color: '#8b93cf', marginTop: 10 }}>
                  avg margin {rivalry.avgMargin > 0 ? '+' : ''}
                  {rivalry.avgMargin.toFixed(1)} for {a.name}
                </div>
              ) : (
                <div style={{ display: 'flex', fontSize: 20, color: '#8b93cf', marginTop: 10 }}>
                  never met in a synced matchup
                </div>
              )}
              {rivalry?.closest ? (
                <div style={{ display: 'flex', fontSize: 18, color: '#5d64a3', marginTop: 6 }}>
                  closest: {rivalry.closest.season} wk {rivalry.closest.week} ·{' '}
                  {rivalry.closest.margin > 0 ? '+' : ''}
                  {rivalry.closest.margin.toFixed(1)}
                </div>
              ) : null}
            </div>
            <ManagerBlock name={b.name} teamName={b.teamName} avatar={b.avatar} align="flex-end" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', fontSize: 15, color: '#5d64a3' }}>
              Counted from every matchup ever played in this league
            </div>
            <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, color: '#c6cbf5' }}>
              AllFantasy.ai · a Brown Pig LLC product
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
