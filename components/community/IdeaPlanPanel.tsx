import { EFFORT_COPY, PLAN_STATUS_COPY, askPosterDraft } from '@/lib/community/ideaPlan'
import { timeAgo } from '@/lib/community/format'
import type { IdeaPlanView } from '@/lib/community/ideaPlanRunner'
import { AskPosterButton, PlanControls } from './IdeaClient'

/**
 * The staff-only build plan on an idea page. The page renders this only for moderators; the
 * member who pitched the idea never sees it.
 */
export function IdeaPlanPanel({
  postId,
  ideaTitle,
  authorUsername,
  isOwnIdea,
  view,
  now,
}: {
  postId: string
  ideaTitle: string
  authorUsername: string
  isOwnIdea: boolean
  view: IdeaPlanView | null
  now: number
}) {
  const plan = view?.plan ?? null
  const status = view?.status ?? null
  // Queued (pending) or mid-run. A Regenerate keeps the old plan on screen until the new one lands.
  const waiting = Boolean(view && (view.running || view.status === 'pending'))
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <h3>{title}</h3>
        <ul>
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    )

  return (
    <section className="ch-plan" aria-labelledby="plan-heading" data-testid="idea-plan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id="plan-heading" className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Staff only · Build plan
        </p>
        <PlanControls postId={postId} waiting={waiting} />
      </div>

      {!view && (
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          This idea was posted before build plans existed. Press Regenerate to have Chimmy write one.
        </p>
      )}
      {view && !plan && status && (
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          {waiting ? PLAN_STATUS_COPY.pending : PLAN_STATUS_COPY[status]}
          {status === 'failed' && view.error ? ` (${view.error})` : ''}
        </p>
      )}

      {plan && (
        <>
          <p className="ch-plan-summary mt-2">{plan.summary}</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--text2)' }}>
            <strong>Effort:</strong> {EFFORT_COPY[plan.effort]}. {plan.effortWhy}
          </p>
          {list('How it plays', plan.howItPlays)}
          <div className="ch-plan-cols">
            {list('Already in AllFantasy', plan.reuse)}
            {list('New to build', plan.build)}
          </div>
          {list('Screens', plan.screens.map((s) => `${s.name}: ${s.purpose}`))}
          {list('Data', plan.dataModel)}
          {plan.steps.length > 0 && (
            <div>
              <h3>Build order</h3>
              <ol>
                {plan.steps.map((s, i) => (
                  <li key={i}>
                    <strong style={{ color: 'var(--text)' }}>{s.title}.</strong> {s.detail}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {list('Risks', plan.risks)}
          {list('From the attached files', plan.fromAttachments)}
          {list('Questions for the poster', plan.openQuestions)}
          {view?.generatedAt && (
            <p className="mt-3 text-xs" style={{ color: 'var(--faint)' }}>
              Written by Chimmy {timeAgo(view.generatedAt, now)}
              {waiting ? ' · a fresh plan is being written' : ''}
            </p>
          )}
        </>
      )}

      {!isOwnIdea && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          <AskPosterButton username={authorUsername} draft={askPosterDraft(ideaTitle, plan?.openQuestions ?? [])} />
        </div>
      )}
    </section>
  )
}
