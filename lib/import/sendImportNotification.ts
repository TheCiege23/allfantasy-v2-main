import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getLevelFromXp } from '@/lib/rank/levels'
import { getResendClient } from '@/lib/resend-client'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'

/** `userId` is AppUser id (session user). */
export async function sendImportCompleteNotification(userId: string, jobId: string): Promise<void> {
  const [job, profile, user] = await Promise.all([
    prisma.legacyImportJob.findUnique({ where: { id: jobId } }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        rankTier: true,
        xpLevel: true,
        xpTotal: true,
        careerWins: true,
        careerChampionships: true,
        careerSeasonsPlayed: true,
      },
    }),
    prisma.appUser.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true },
    }),
  ])

  const xpNum = Number(profile?.xpTotal ?? job?.lastXpTotal ?? 0)
  const lvl = getLevelFromXp(Number.isFinite(xpNum) ? xpNum : 0)
  const levelName = lvl.name

  const sourceKey = `import-complete-${jobId}`

  try {
    await prisma.platformNotification.upsert({
      where: { sourceKey },
      update: {},
      create: {
        userId,
        sourceKey,
        type: 'import_complete',
        productType: 'app',
        severity: 'info',
        title: 'Your legacy profile is ready!',
        body: `Imported ${job?.totalLeaguesSaved ?? 0} leagues across ${job?.seasonsCompleted ?? 0} seasons. You ranked in at Level ${profile?.xpLevel ?? 1} — ${levelName}.`,
        meta: {
          jobId,
          totalLeagues: job?.totalLeaguesSaved,
          totalSeasons: job?.seasonsCompleted,
          rankTier: profile?.rankTier,
          xpLevel: profile?.xpLevel,
          levelName,
        } as Prisma.InputJsonValue,
      },
    })
  } catch (e: unknown) {
    console.error('[notification] upsert failed:', e)
  }

  if (user?.email && process.env.RESEND_API_KEY) {
    try {
      const { client, fromEmail } = getResendClient()
      await client.emails.send({
        from: fromEmail,
        to: user.email,
        subject: `Your rank is in — Level ${profile?.xpLevel ?? 1} ${levelName}`,
        html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">Your legacy profile is ready, ${user.displayName ?? 'Manager'}!</h2>
          <p style="color:#666;margin:0 0 20px">We scanned your full Sleeper history:</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">Leagues imported</td>
                <td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px solid #eee">${job?.totalLeaguesSaved ?? 0}</td></tr>
            <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">Seasons covered</td>
                <td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px solid #eee">${job?.seasonsCompleted ?? 0}</td></tr>
            <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">Career wins</td>
                <td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px solid #eee">${profile?.careerWins ?? 0}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Championships</td>
                <td style="padding:8px 0;text-align:right;font-weight:600">${profile?.careerChampionships ?? 0}</td></tr>
          </table>
          <div style="background:${lvl.bgColor};border:2px solid ${lvl.color};border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
            <div style="font-size:48px;font-weight:700;color:${lvl.color};line-height:1">${profile?.xpLevel ?? 1}</div>
            <div style="font-size:22px;font-weight:600;color:${lvl.color};margin-top:4px">${levelName}</div>
            <div style="color:${lvl.color};opacity:.7;margin-top:2px">${profile?.rankTier ?? 'Rookie'} Tier</div>
          </div>
          <a href="${getPublicSiteOrigin()}/core/rankings?scope=portfolio&amp;panel=legacy"
             style="display:inline-block;background:${lvl.color};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:500">
            View My Rank
          </a>
        </div>`,
      })
    } catch (e: unknown) {
      console.error('[import] email failed (non-fatal):', e)
    }
  }

  await prisma.legacyImportJob
    .update({
      where: { id: jobId },
      data: { notificationSent: true },
    })
    .catch(() => {})
}
