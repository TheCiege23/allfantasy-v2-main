import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import { resolveChimmyClaudeModel } from '@/lib/ai/chimmyClaudeConfig'
import { getResendClient } from '@/lib/resend-client'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { clubhousePostHref } from './channels'
import { loadIdeaAttachmentBytes } from './ideaFiles'
import { IDEA_KIND, parseIdeaDetails } from './ideas'
import {
  BUILD_PLAN_JSON_SCHEMA,
  PLAN_MAX_ATTEMPTS,
  PLAN_STALE_MS,
  PLAN_SYSTEM_PROMPT,
  buildPlanEmail,
  isPlanStatus,
  parseBuildPlan,
  planUserText,
  type BuildPlan,
  type PlanStatus,
} from './ideaPlan'
import { CommunityError, staffEmailSet, type CommunityViewer } from './service'

/**
 * Writes, stores and emails the build plan for a League Lab idea.
 *
 * Three things start a run, and all three go through `claimPlanRun`, so two of them firing at
 * once produce one plan, not two:
 *   1. the idea form, once its files are uploaded (POST /api/community/ideas/[id]/plan);
 *   2. staff pressing Regenerate on the idea;
 *   3. the Clubhouse sweep on the import-news cron, which picks up a run the first two missed
 *      (a closed tab, a deploy mid-run) and retries a failure up to PLAN_MAX_ATTEMPTS.
 */

export type PlanRunResult = 'ready' | 'failed' | 'disabled' | 'skipped'

/** Waits this long after an idea is posted before the sweep steps in, so the form's own run goes first. */
const SWEEP_GRACE_MS = 10 * 60 * 1000

/**
 * Takes the run if nobody else holds it. A run holds the row by setting `startedAt`; one that
 * started more than PLAN_STALE_MS ago was killed and is fair game.
 */
async function claimPlanRun(postId: string, now: Date, force: boolean): Promise<boolean> {
  const stale = new Date(now.getTime() - PLAN_STALE_MS)
  const res = await prisma.communityIdeaPlan.updateMany({
    where: {
      postId,
      OR: [{ startedAt: null }, { startedAt: { lt: stale } }],
      ...(force ? {} : { status: { in: ['pending', 'failed', 'disabled'] }, attempts: { lt: PLAN_MAX_ATTEMPTS } }),
    },
    data: { startedAt: now, attempts: { increment: 1 } },
  })
  return res.count === 1
}

async function askClaude(args: {
  idea: Parameters<typeof planUserText>[0]
  files: Awaited<ReturnType<typeof loadIdeaAttachmentBytes>>
}): Promise<{ plan: BuildPlan; model: string } | { error: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'no Claude key configured' }
  const model = resolveChimmyClaudeModel()
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 240_000 })
  const content: Anthropic.ContentBlockParam[] = []
  for (const f of args.files) {
    const data = f.data.toString('base64')
    if (f.contentType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: f.fileName })
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: f.contentType, data } })
    }
  }
  content.push({ type: 'text', text: planUserText(args.idea) })
  try {
    const message = await client.messages
      .stream({
        model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: BUILD_PLAN_JSON_SCHEMA as unknown as Record<string, unknown> } },
        system: PLAN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      })
      .finalMessage()
    if (message.stop_reason !== 'end_turn') return { error: `stopped: ${message.stop_reason ?? 'unknown'}` }
    const raw = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const plan = parseBuildPlan(raw)
    return plan ? { plan, model } : { error: 'reply was not a valid plan' }
  } catch (err) {
    // Never the message: an SDK error can echo request details. The status is enough to act on.
    const status = err && typeof err === 'object' && 'status' in err ? String((err as { status: unknown }).status) : 'no status'
    return { error: `Claude request failed (${status})` }
  }
}

async function emailPlan(postId: string, plan: BuildPlan, idea: { title: string; author: string; files: number }) {
  const to = [...staffEmailSet()]
  if (to.length === 0 || !process.env.RESEND_API_KEY) return false
  const email = buildPlanEmail({
    ideaTitle: idea.title,
    authorName: idea.author,
    ideaUrl: `${getPublicSiteOrigin()}${clubhousePostHref(postId)}`,
    plan,
    attachmentCount: idea.files,
  })
  const { client, fromEmail } = getResendClient()
  const res = await client.emails.send({ from: fromEmail, to, subject: email.subject, html: email.html, text: email.text })
  if (res.error) {
    console.warn('[community/idea-plan] email failed', { postId, name: res.error.name })
    return false
  }
  return true
}

/** One run for one idea. Never throws; the outcome is written to the plan row. */
export async function generateIdeaPlan(postId: string, opts: { force?: boolean; now?: Date } = {}): Promise<PlanRunResult> {
  const now = opts.now ?? new Date()
  if (!(await claimPlanRun(postId, now, Boolean(opts.force)))) return 'skipped'
  const finish = (data: Prisma.CommunityIdeaPlanUpdateInput) =>
    prisma.communityIdeaPlan.update({ where: { postId }, data: { startedAt: null, ...data } })

  try {
    const post = await prisma.communityPost.findUnique({
      where: { id: postId },
      select: {
        kind: true,
        title: true,
        body: true,
        removedAt: true,
        ideaDetails: true,
        author: { select: { username: true, displayName: true } },
        ideaPlan: { select: { attempts: true, emailedAt: true } },
      },
    })
    if (!post || post.kind !== IDEA_KIND || post.removedAt) {
      await finish({ status: 'failed', error: 'idea missing or removed' })
      return 'failed'
    }
    if (!isAiSpendEnabled()) {
      await finish({ status: 'disabled', error: null })
      return 'disabled'
    }
    const details = parseIdeaDetails(post.ideaDetails)
    const files = await loadIdeaAttachmentBytes(postId)
    const result = await askClaude({
      idea: {
        title: post.title,
        hook: details.hook,
        body: post.body,
        sport: details.sport,
        teamSize: details.teamSize,
        draftType: details.draftType,
        attachmentNames: files.map((f) => f.fileName),
      },
      files,
    })
    if ('error' in result) {
      const attempts = post.ideaPlan?.attempts ?? PLAN_MAX_ATTEMPTS
      await finish({ status: attempts >= PLAN_MAX_ATTEMPTS ? 'failed' : 'pending', error: result.error.slice(0, 200) })
      return 'failed'
    }
    await finish({
      status: 'ready',
      plan: result.plan as unknown as Prisma.InputJsonObject,
      model: result.model.slice(0, 64),
      error: null,
      generatedAt: new Date(),
    })
    // Email once per idea: a Regenerate refreshes the page, not your inbox.
    if (!post.ideaPlan?.emailedAt) {
      const sent = await emailPlan(postId, result.plan, {
        title: post.title,
        author: post.author.displayName || post.author.username || 'a member',
        files: files.length,
      }).catch(() => false)
      if (sent) await prisma.communityIdeaPlan.update({ where: { postId }, data: { emailedAt: new Date() } })
    }
    return 'ready'
  } catch (err) {
    console.error('[community/idea-plan] run failed', { postId, error: err instanceof Error ? err.name : 'unknown' })
    await finish({ status: 'pending', error: 'run crashed; will retry' }).catch(() => {})
    return 'failed'
  }
}

/**
 * Who may start a run from the idea page. The author only nudges the first one along (after
 * their files upload); staff may force a fresh plan at any time.
 */
export async function requestIdeaPlan(viewer: CommunityViewer, postId: string): Promise<{ force: boolean }> {
  if (!viewer.userId) throw new CommunityError(401, 'Sign in first.')
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { kind: true, authorUserId: true, removedAt: true },
  })
  if (!post || post.kind !== IDEA_KIND || post.removedAt) throw new CommunityError(404, 'Idea not found')
  if (viewer.isModerator) {
    await prisma.communityIdeaPlan.upsert({
      where: { postId },
      create: { postId },
      update: { status: 'pending', error: null, attempts: 0 },
    })
    return { force: true }
  }
  if (post.authorUserId !== viewer.userId) throw new CommunityError(403, 'Only staff can do that.')
  await prisma.communityIdeaPlan.upsert({ where: { postId }, create: { postId }, update: {} })
  return { force: false }
}

/** The cron's share: at most `limit` runs per pass, oldest first. */
export async function sweepIdeaPlans(now = new Date(), limit = 2): Promise<{ ran: number; results: PlanRunResult[] }> {
  const stale = new Date(now.getTime() - PLAN_STALE_MS)
  const due = await prisma.communityIdeaPlan.findMany({
    where: {
      status: { in: isAiSpendEnabled() ? ['pending', 'disabled'] : ['pending'] },
      attempts: { lt: PLAN_MAX_ATTEMPTS },
      createdAt: { lt: new Date(now.getTime() - SWEEP_GRACE_MS) },
      OR: [{ startedAt: null }, { startedAt: { lt: stale } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { postId: true },
  })
  const results: PlanRunResult[] = []
  for (const d of due) results.push(await generateIdeaPlan(d.postId, { now }))
  return { ran: due.length, results }
}

export type IdeaPlanView = {
  status: PlanStatus
  plan: BuildPlan | null
  error: string | null
  generatedAt: string | null
  running: boolean
}

export async function getIdeaPlan(postId: string): Promise<IdeaPlanView | null> {
  const row = await prisma.communityIdeaPlan.findUnique({
    where: { postId },
    select: { status: true, plan: true, error: true, generatedAt: true, startedAt: true },
  })
  if (!row) return null
  return {
    status: isPlanStatus(row.status) ? row.status : 'pending',
    plan: row.plan ? parseBuildPlan(row.plan) : null,
    error: row.error,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    running: Boolean(row.startedAt && Date.now() - row.startedAt.getTime() < PLAN_STALE_MS),
  }
}

export type IdeaPlanListItem = {
  postId: string
  title: string
  author: string
  status: PlanStatus
  effort: BuildPlan['effort'] | null
  summary: string | null
  questions: number
  upvotes: number
  files: number
  createdAt: string
}

/** Staff list: every idea that has a plan row, newest first. */
export async function listIdeaPlans(limit = 100): Promise<IdeaPlanListItem[]> {
  const rows = await prisma.communityIdeaPlan.findMany({
    where: { post: { removedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      postId: true,
      status: true,
      plan: true,
      post: {
        select: {
          title: true,
          upvoteCount: true,
          createdAt: true,
          author: { select: { username: true, displayName: true } },
          _count: { select: { attachments: true } },
        },
      },
    },
  })
  return rows.map((r) => {
    const plan = r.plan ? parseBuildPlan(r.plan) : null
    return {
      postId: r.postId,
      title: r.post.title,
      author: r.post.author.displayName || r.post.author.username || 'member',
      status: isPlanStatus(r.status) ? r.status : 'pending',
      effort: plan?.effort ?? null,
      summary: plan?.summary ?? null,
      questions: plan?.openQuestions.length ?? 0,
      upvotes: r.post.upvoteCount,
      files: r.post._count.attachments,
      createdAt: r.post.createdAt.toISOString(),
    }
  })
}
