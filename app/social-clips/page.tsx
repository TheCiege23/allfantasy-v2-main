'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SUPPORTED_SPORTS } from '@/lib/sport-scope';
import { SOCIAL_ASSET_TYPES, type SocialAssetType } from '@/lib/social-clips-grok/types';
import {
  CLIP_INPUT_TYPES,
  CLIP_OUTPUT_TYPES,
  type ClipInputType,
  type ClipOutputType,
} from '@/lib/ai-social-clip-engine/types';
import { useUserTimezone } from '@/hooks/useUserTimezone';

const ASSET_TYPE_LABELS: Record<SocialAssetType, string> = {
  weekly_league_winners: 'Weekly League Winners',
  biggest_upset: 'Biggest Upset',
  top_scoring_team: 'Top Scoring Team',
  trending_waiver_adds: 'Trending Waiver Adds',
  draft_highlights: 'Draft Highlights',
  rivalry_moments: 'Rivalry Moments',
  bracket_challenge_highlights: 'Bracket Challenge Highlights',
  ai_insight_moments: 'Chimmy Insight Moments',
  sport_platform_highlights: 'Sport Platform Highlights',
};

const AI_INPUT_LABELS: Record<ClipInputType, string> = {
  matchup_result: 'Matchup result',
  trade_verdict: 'Trade verdict',
  power_rankings: 'Power rankings',
  player_trend_alert: 'Player trend alert',
  story_recap: 'Story recap',
  creator_league_promo: 'Creator league promo',
  bracket_update: 'Bracket update',
};
const AI_OUTPUT_LABELS: Record<ClipOutputType, string> = {
  short_post: 'Short post',
  thread_format: 'Thread format',
  image_caption: 'Image caption',
  video_caption: 'Video caption',
  promo_copy: 'Promo copy',
  recap_copy: 'Recap copy',
};

interface AssetRow {
  id: string;
  sport: string;
  assetType: string;
  title: string;
  provider: string | null;
  approvedForPublish: boolean;
  createdAt: string;
}

export default function SocialClipsPage() {
  const { formatDateInTimezone } = useUserTimezone();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<{ anyAvailable?: boolean; xai?: boolean; openai?: boolean; deepseek?: boolean } | null>(null);
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0] ?? 'NFL');
  const [selectedType, setSelectedType] = useState<SocialAssetType>('weekly_league_winners');
  const [leagueName, setLeagueName] = useState('');
  const [week, setWeek] = useState<number | ''>('');
  const [tone, setTone] = useState('energetic and fun');
  const [brandingHint, setBrandingHint] = useState('AllFantasy — fantasy sports insights');
  const [aiInputType, setAiInputType] = useState<ClipInputType>('matchup_result');
  const [aiOutputType, setAiOutputType] = useState<ClipOutputType>('short_post');
  const [aiFactsSummary, setAiFactsSummary] = useState('');

  const fetchAssets = () => {
    setLoading(true);
    fetch('/api/social-clips', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.assets) setAssets(data.assets);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  useEffect(() => {
    fetch('/api/social-clips/ai/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setProviderStatus)
      .catch(() => setProviderStatus({ anyAvailable: false }));
  }, []);

  const handleGenerate = () => {
    setGenerating(true);
    fetch('/api/social-clips/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sport,
        assetType: selectedType,
        leagueName: leagueName.trim() || undefined,
        week: typeof week === 'number' ? week : undefined,
        tone: tone.trim() || undefined,
        brandingHint: brandingHint.trim() || undefined,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) {
          window.location.href = `/social-clips/${data.id}`;
          return;
        }
        setGenerating(false);
      })
      .catch(() => setGenerating(false));
  };

  const handleAiGenerate = () => {
    setAiError(null);
    setAiGenerating(true);
    const body: Record<string, unknown> = {
      inputType: aiInputType,
      outputType: aiOutputType,
      sport,
      leagueName: leagueName.trim() || undefined,
    };
    if (aiFactsSummary.trim()) {
      body.deterministicFacts = { storySummary: aiFactsSummary.trim(), leagueName: leagueName.trim() || undefined };
    }
    fetch('/api/social-clips/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) {
          window.location.href = `/social-clips/${data.id}`;
          return;
        }
        setAiError(data?.error ?? 'Generation failed');
        setAiGenerating(false);
      })
      .catch(() => {
        setAiError('Request failed');
        setAiGenerating(false);
      });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex items-center gap-4">
        <Link
          href="/app"
          className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:underline"
          data-testid="social-clips-back-button"
          data-audit="back-button"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>

      {/* AI Social Clip (PROMPT 146) */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" /> Chimmy social clip
          </CardTitle>
          <p className="text-sm text-zinc-400">
            Multi-provider: narrative (xAI) → fact check (DeepSeek) → polish (OpenAI). Generate → preview → edit → approve → publish or copy.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {providerStatus && !providerStatus.anyAvailable && (
            <p
              className="text-amber-400 text-sm"
              data-testid="social-clip-ai-provider-unavailable-message"
            >
              No Chimmy provider available. Set XAI_API_KEY or OPENAI_API_KEY.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-zinc-400">Input type</label>
              <select
                value={aiInputType}
                onChange={(e) => setAiInputType(e.target.value as ClipInputType)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
                data-testid="social-clip-ai-input-type-selector"
              >
                {CLIP_INPUT_TYPES.map((t) => (
                  <option key={t} value={t}>{AI_INPUT_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm text-zinc-400">Output type</label>
              <select
                value={aiOutputType}
                onChange={(e) => setAiOutputType(e.target.value as ClipOutputType)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
                data-testid="social-clip-ai-output-type-selector"
              >
                {CLIP_OUTPUT_TYPES.map((t) => (
                  <option key={t} value={t}>{AI_OUTPUT_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Sport</label>
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
                data-testid="social-clip-grok-sport-selector"
                data-audit="sport-selector"
            >
              {SUPPORTED_SPORTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Facts / context (optional)</label>
            <textarea
              value={aiFactsSummary}
              onChange={(e) => setAiFactsSummary(e.target.value)}
              placeholder="e.g. Team A 142, Team B 118. Week 7."
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white placeholder-zinc-500"
              data-testid="social-clip-ai-facts-input"
            />
          </div>
          {aiError && (
            <p className="text-amber-400 text-sm" data-testid="social-clip-ai-error-message">
              {aiError}
            </p>
          )}
          <Button
            onClick={handleAiGenerate}
            disabled={aiGenerating || (providerStatus !== null && !providerStatus.anyAvailable)}
            className="w-full gap-2"
            data-testid="social-clip-ai-generate-button"
            data-audit="generate-ai-social-clip-button"
          >
            {aiGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate clip
          </Button>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Grok social clip generator</CardTitle>
          <p className="text-sm text-zinc-400">
            Generate short-form social content with Grok: captions, headlines, hashtags, and platform variants. Optional auto-posting when accounts are connected.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Sport</label>
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
            >
              {SUPPORTED_SPORTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Clip type</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as SocialAssetType)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
              data-testid="social-clip-type-selector"
              data-audit="clip-type-selector"
            >
              {(SOCIAL_ASSET_TYPES as readonly string[]).map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t as SocialAssetType]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-zinc-400">League name (optional)</label>
            <input
              type="text"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              placeholder="My League"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white placeholder-zinc-500"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Tone</label>
            <input
              type="text"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="energetic and fun"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white placeholder-zinc-500"
              data-testid="social-clip-tone-input"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Branding hint</label>
            <input
              type="text"
              value={brandingHint}
              onChange={(e) => setBrandingHint(e.target.value)}
              placeholder="AllFantasy — fantasy sports insights"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white placeholder-zinc-500"
              data-testid="social-clip-branding-input"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Week (optional)</label>
            <input
              type="number"
              min={1}
              value={week}
              onChange={(e) => setWeek(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              placeholder="1"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white placeholder-zinc-500"
            />
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full gap-2"
            data-testid="social-clip-generate-button"
            data-audit="generate-social-clip-button"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            Generate social clip
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Your Grok clips</h2>
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="text-zinc-500">No clips yet. Generate one above.</p>
        ) : (
          <ul className="space-y-2">
            {assets.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/social-clips/${a.id}`}
                  className="block rounded-lg border border-white/10 bg-white/5 p-3 text-white hover:bg-white/10"
                  data-testid={`social-clip-preview-card-${a.id}`}
                >
                  <span className="font-medium">{a.title}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {(a.assetType?.startsWith('ai_clip_')
                      ? AI_INPUT_LABELS[a.assetType.replace(/^ai_clip_/, '') as ClipInputType]
                      : ASSET_TYPE_LABELS[a.assetType as SocialAssetType]) ?? a.assetType} · {a.sport} ·{' '}
                    {formatDateInTimezone(a.createdAt)}
                    {a.approvedForPublish && ' · Approved'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
