'use client'

import { useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { LeagueStoryCard, LEAGUE_STORY_CARD_ID } from './LeagueStoryCard'
import { postWithTokenConfirm } from '@/lib/tokens/clientTokenConfirm'
import type { LeagueStoryPayload, LeagueStoryType } from '@/lib/league-story-engine/types'
import type {
  StoryOutput,
  StoryStyle,
  StoryType,
} from '@/lib/league-story-creator/types'

type PreviewTab = 'structured' | 'short' | 'social' | 'long'

interface StoryCreateResponse {
  story?: StoryOutput
  sections?: Array<{ id: string; title: string; content: string }>
  variants?: { short: string; social: string; long: string } | null
  style?: StoryStyle
  factGuardWarnings?: string[]
  factGuardErrors?: string[]
}

const STORY_TYPES: Array<{ id: StoryType; label: string }> = [
  { id: 'weekly_recap', label: 'Weekly Recap' },
  { id: 'rivalry', label: 'Rivalry Story' },
  { id: 'upset', label: 'Upset Story' },
  { id: 'playoff_bubble', label: 'Playoff Bubble' },
  { id: 'title_defense', label: 'Title Defense' },
  { id: 'trade_fallout', label: 'Trade Fallout' },
  { id: 'dynasty', label: 'Dynasty Story' },
  { id: 'bracket_challenge', label: 'Bracket Challenge' },
  { id: 'platform_sport', label: 'Platform Sport Story' },
]

const STYLE_OPTIONS: StoryStyle[] = ['announcer', 'recap', 'neutral']
const LeagueStoryShareBar = dynamic(
  () => import('./LeagueStoryShareBar').then((mod) => mod.LeagueStoryShareBar),
  { ssr: false }
)

function mapStoryTypeToShareType(storyType: StoryType): LeagueStoryType {
  if (storyType === 'rivalry') return 'rivalry_spotlight'
  if (storyType === 'upset') return 'underdog_story'
  if (storyType === 'title_defense') return 'dominant_team'
  if (storyType === 'trade_fallout') return 'comeback_trajectory'
  return 'league_spotlight'
}

export interface LeagueStoryModalProps {
  leagueId: string
  leagueName: string
  week?: number
  season?: string
  sport?: string
  /** Pre-built payload (e.g. from client-side engine); if not provided, we create from context and call API */
  initialPayload?: LeagueStoryPayload | null
  onClose: () => void
  className?: string
}

export function LeagueStoryModal({
  leagueId,
  leagueName,
  week,
  season,
  sport,
  initialPayload = null,
  onClose,
  className = '',
}: LeagueStoryModalProps) {
  const [step, setStep] = useState<'creating' | 'sharing'>('creating')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [payload, setPayload] = useState<LeagueStoryPayload | null>(initialPayload ?? null)
  const [story, setStory] = useState<StoryOutput | null>(null)
  const [sections, setSections] = useState<Array<{ id: string; title: string; content: string }>>([])
  const [variants, setVariants] = useState<{ short: string; social: string; long: string } | null>(null)
  const [selectedStoryType, setSelectedStoryType] = useState<StoryType>('weekly_recap')
  const [selectedStyle, setSelectedStyle] = useState<StoryStyle>('recap')
  const [previewTab, setPreviewTab] = useState<PreviewTab>('structured')
  const [factGuardWarnings, setFactGuardWarnings] = useState<string[]>([])
  const [factGuardErrors, setFactGuardErrors] = useState<string[]>([])
  const [copiedPreview, setCopiedPreview] = useState(false)
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)

  const storyPreviewText = useMemo(() => {
    if (!story) return ''
    if (previewTab === 'structured') {
      return sections.map((section) => `${section.title}: ${section.content}`).join('\n\n')
    }
    if (previewTab === 'short') return variants?.short ?? story.shortVersion ?? ''
    if (previewTab === 'social') return variants?.social ?? story.socialVersion ?? ''
    return variants?.long ?? story.longVersion ?? ''
  }, [previewTab, sections, story, variants])

  const previewPayload: LeagueStoryPayload = useMemo(() => {
    if (payload && step === 'sharing') return payload
    if (story) {
      return {
        storyType: mapStoryTypeToShareType(selectedStoryType),
        title: story.headline,
        narrative:
          previewTab === 'structured'
            ? `${story.whatHappened} ${story.whyItMatters}`.trim()
            : storyPreviewText || `${story.whatHappened} ${story.whyItMatters}`.trim(),
        leagueId,
        leagueName,
        week,
        season,
        sport,
        highlight: story.nextStorylineToWatch,
      }
    }
    return (
      initialPayload ?? {
        storyType: 'league_spotlight',
        title: 'League spotlight',
        narrative: `${leagueName} — where every week brings new twists. Stay locked in for the playoff push.`,
        leagueId,
        leagueName,
        week,
        season,
        sport,
      }
    )
  }, [
    initialPayload,
    leagueId,
    leagueName,
    payload,
    previewTab,
    season,
    sport,
    step,
    story,
    storyPreviewText,
    selectedStoryType,
    week,
  ])

  const generateStory = useCallback(async () => {
    setIsGenerating(true)
    setError(null)
    setFactGuardWarnings([])
    setFactGuardErrors([])
    try {
      // Asks before any token is spent; a decline spends nothing and changes nothing.
      const { response: res, declined } = await postWithTokenConfirm(
        `/api/leagues/${encodeURIComponent(leagueId)}/story/create`,
        {
          storyType: selectedStoryType,
          sport,
          season,
          style: selectedStyle,
        },
      )
      if (declined) return
      const data = (await res.json().catch(() => ({}))) as StoryCreateResponse & { error?: string }
      if (!res.ok) {
        const gateMessage =
          typeof (data as { message?: unknown }).message === 'string'
            ? ((data as { message?: string }).message ?? '')
            : ''
        setError(gateMessage || data.error || 'Failed to generate story')
        return
      }
      setStory(data.story ?? null)
      setSections(data.sections ?? [])
      setVariants(data.variants ?? null)
      setFactGuardWarnings(Array.isArray(data.factGuardWarnings) ? data.factGuardWarnings : [])
      setFactGuardErrors(Array.isArray(data.factGuardErrors) ? data.factGuardErrors : [])
      setPreviewTab('structured')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate story')
    } finally {
      setIsGenerating(false)
    }
  }, [leagueId, season, selectedStoryType, selectedStyle, sport])

  const createShare = useCallback(async () => {
    setIsSharing(true)
    setError(null)
    try {
      const res = await fetch('/api/share/league-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          week,
          season,
          sport,
          customTitle: previewPayload.title,
          customNarrative: previewPayload.narrative,
          storyType: previewPayload.storyType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to create story share')
        return
      }
      setShareUrl(data.shareUrl || '')
      setPayload(data.payload || null)
      setStep('sharing')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setIsSharing(false)
    }
  }, [leagueId, previewPayload.narrative, previewPayload.storyType, previewPayload.title, season, sport, week])

  const copyPreview = useCallback(() => {
    if (!storyPreviewText) return
    void navigator.clipboard
      .writeText(storyPreviewText)
      .then(() => {
        setCopiedPreview(true)
        setTimeout(() => setCopiedPreview(false), 1500)
      })
      .catch(() => {
        setError('Clipboard access is unavailable in this browser context.')
      })
  }, [storyPreviewText])

  if (step === 'sharing' && payload) {
    return (
      <div
        data-testid="league-story-modal"
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 ${className}`}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="max-h-[90vh] max-w-full overflow-auto rounded-2xl border border-white/10 bg-[#081026] p-6">
          <div className="mb-2 flex justify-between">
            <button
              type="button"
              data-testid="league-story-back-to-editor-button"
              onClick={() => setStep('creating')}
              className="text-sm text-slate-300 hover:text-white"
            >
              Back to editor
            </button>
            <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-white">
              Close
            </button>
          </div>
          <div className="flex flex-col items-center gap-4">
            <LeagueStoryCard payload={payload} captureId={LEAGUE_STORY_CARD_ID} dataTestId="league-story-preview-card" />
            <LeagueStoryShareBar payload={payload} shareUrl={shareUrl} />
            {!!shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="league-story-open-detail-link"
                className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20"
              >
                Open story detail page
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="league-story-modal"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 ${className}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-[#081026] p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-white">League Story Creator</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">
            ×
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-300">
          Generate fact-grounded stories from league intelligence, then share a polished card.
        </p>
        <button
          type="button"
          data-testid="league-story-mobile-controls-toggle"
          onClick={() => setMobileControlsOpen((value) => !value)}
          className="mb-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 md:hidden"
        >
          {mobileControlsOpen ? 'Hide controls' : 'Show controls'}
        </button>

        <div className={`${mobileControlsOpen ? 'block' : 'hidden'} space-y-4 md:block`}>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">Story Type</p>
            <div className="flex flex-wrap gap-2" data-testid="league-story-type-selector">
              {STORY_TYPES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-testid={`league-story-type-${option.id}-button`}
                  onClick={() => setSelectedStoryType(option.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    selectedStoryType === option.id
                      ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
                      : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">Style</p>
            <div className="flex flex-wrap gap-2" data-testid="league-story-style-selector">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`league-story-style-${option}-button`}
                  onClick={() => setSelectedStyle(option)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
                    selectedStyle === option
                      ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
                      : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p data-testid="league-story-error-state" className="my-3 text-sm text-red-400">{error}</p>}
        {factGuardWarnings.length > 0 && (
          <div data-testid="league-story-fact-guard-warnings" className="my-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
            {factGuardWarnings.map((warning, index) => (
              <p key={`${warning}-${index}`}>- {warning}</p>
            ))}
          </div>
        )}
        {factGuardErrors.length > 0 && (
          <div data-testid="league-story-fact-guard-errors" className="my-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-100">
            {factGuardErrors.map((warning, index) => (
              <p key={`${warning}-${index}`}>- {warning}</p>
            ))}
          </div>
        )}
        <div className="my-4">
          <LeagueStoryCard payload={previewPayload} captureId={LEAGUE_STORY_CARD_ID} dataTestId="league-story-preview-card" />
        </div>

        {story && (
          <div className="mb-4 rounded-xl border border-white/10 bg-[#040915] p-3">
            <div className="mb-2 flex flex-wrap gap-2" data-testid="league-story-preview-tabs">
              {(['structured', 'short', 'social', 'long'] as PreviewTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-testid={`league-story-preview-tab-${tab}`}
                  onClick={() => setPreviewTab(tab)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium capitalize ${
                    previewTab === tab
                      ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
                      : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            {previewTab === 'structured' ? (
              <div data-testid="league-story-structured-preview" className="space-y-2">
                {sections.map((section) => (
                  <div key={section.id}>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{section.title}</p>
                    <p className="text-sm text-slate-100 whitespace-pre-wrap">{section.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p data-testid="league-story-variant-preview" className="text-sm text-slate-100 whitespace-pre-wrap">
                {storyPreviewText}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="league-story-generate-button"
            disabled={isGenerating}
            onClick={generateStory}
            className="rounded-xl bg-cyan-500/90 px-4 py-2.5 text-sm font-semibold text-[#041126] hover:bg-cyan-400 disabled:opacity-60"
          >
            {isGenerating ? 'Generating…' : story ? 'Generate Story' : 'Generate Story'}
          </button>
          <button
            type="button"
            data-testid="league-story-regenerate-button"
            disabled={isGenerating}
            onClick={generateStory}
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 disabled:opacity-60"
          >
            Regenerate
          </button>
          <button
            type="button"
            data-testid="league-story-copy-preview-button"
            onClick={copyPreview}
            disabled={!storyPreviewText}
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 disabled:opacity-50"
          >
            {copiedPreview ? 'Copied preview' : 'Copy preview'}
          </button>
          <button
            type="button"
            data-testid="league-story-create-share-link-button"
            disabled={isSharing}
            onClick={createShare}
            className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
          >
            {isSharing ? 'Creating link…' : 'Create share link'}
          </button>
        </div>
      </div>
    </div>
  )
}
