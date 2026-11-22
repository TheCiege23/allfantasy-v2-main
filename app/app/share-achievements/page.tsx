'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Share2, Copy, Loader2, Trophy, Zap, Target, ImagePlus, FileText, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getAchievementSharePayload,
  ACHIEVEMENT_SHARE_TYPES,
} from '@/lib/social-sharing';
import { getTwitterShareUrl, getRedditShareUrl } from '@/lib/social-sharing/SocialShareService';
import type { AchievementShareType, AchievementShareContext } from '@/lib/social-sharing/types';
import { toast } from 'sonner';
import { SUPPORTED_SPORTS } from '@/lib/sport-scope';
import { SUPPORTED_PLATFORMS } from '@/lib/social-clips-grok/types';

const TYPE_LABELS: Record<string, string> = {
  winning_matchup: 'Winning a matchup',
  winning_league: 'Winning a league',
  high_scoring_team: 'High scoring team',
  bracket_success: 'Bracket success',
  rivalry_win: 'Rivalry win',
  playoff_qualification: 'Playoff qualification',
  championship_win: 'Championship win',
  great_waiver_pickup: 'Great waiver pickup',
  great_trade: 'Great trade',
  major_upset: 'Major upset',
  top_rank_legacy: 'Top rank / legacy',
};

const TYPE_ICONS: Record<string, typeof Trophy> = {
  winning_matchup: Target,
  winning_league: Trophy,
  high_scoring_team: Zap,
  bracket_success: Trophy,
  rivalry_win: Target,
  playoff_qualification: Zap,
  championship_win: Trophy,
  great_waiver_pickup: Zap,
  great_trade: Target,
  major_upset: Zap,
  top_rank_legacy: Trophy,
};

function getDefaultContext(type: AchievementShareType): AchievementShareContext {
  const base = { leagueName: 'My League', teamName: 'My team' };
  switch (type) {
    case 'winning_matchup':
      return { ...base, opponentName: 'my opponent', week: 1 };
    case 'winning_league':
      return base;
    case 'high_scoring_team':
      return { ...base, score: 180, week: 1 };
    case 'bracket_success':
      return { ...base, bracketName: 'My Bracket' };
    case 'rivalry_win':
      return { ...base, rivalryName: 'my rival', opponentName: 'my rival' };
    case 'playoff_qualification':
    case 'championship_win':
      return base;
    case 'great_waiver_pickup':
      return { ...base, playerName: 'a stud' };
    case 'great_trade':
      return base;
    case 'major_upset':
      return { ...base, opponentName: 'the favorite' };
    case 'top_rank_legacy':
      return { ...base, rank: 1, tier: 'Elite' };
    default:
      return base;
  }
}

type Target = {
  platform: string;
  accountIdentifier: string | null;
  autoPostingEnabled: boolean;
  connected: boolean;
  providerConfigured?: boolean;
};

type PublishLog = {
  id: string;
  platform: string;
  status: string;
  createdAt: string;
  responseMetadata?: Record<string, unknown> | null;
};

type PreviewState = {
  shareUrl: string;
  title: string;
  caption: string;
  cta?: string;
  hashtags?: string[];
};

export default function ShareAchievementsPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCaptionId, setCopiedCaptionId] = useState<string | null>(null);
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0] ?? 'NFL');
  const [shareId, setShareId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('x');
  const [approvedForPublish, setApprovedForPublish] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [logs, setLogs] = useState<PublishLog[]>([]);
  const [generatingCard, setGeneratingCard] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const selectedTarget = useMemo(
    () => targets.find((target) => target.platform === selectedPlatform),
    [targets, selectedPlatform]
  );
  const retryableLog = useMemo(
    () =>
      logs.find(
        (log) =>
          log.platform === selectedPlatform &&
          (log.status === 'failed' || log.status === 'provider_unavailable')
      ) ?? null,
    [logs, selectedPlatform]
  );

  const loadTargets = useCallback(async () => {
    try {
      const res = await fetch('/api/share/targets', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load connected accounts');
      setTargets(Array.isArray(data.targets) ? (data.targets as Target[]) : []);
    } catch {
      setTargets([]);
    }
  }, []);

  const loadPublishLogs = useCallback(async (nextShareId: string | null = shareId) => {
    if (!nextShareId) {
      setLogs([]);
      return;
    }
    try {
      const res = await fetch(`/api/share/publish?shareId=${encodeURIComponent(nextShareId)}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load publish logs');
      setLogs(Array.isArray(data.logs) ? (data.logs as PublishLog[]) : []);
    } catch {
      setLogs([]);
    }
  }, [shareId]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    if (!shareId) {
      setLogs([]);
      return;
    }
    void loadPublishLogs(shareId);
  }, [shareId, loadPublishLogs]);

  const openTwitter = useCallback((type: AchievementShareType, context: AchievementShareContext) => {
    const { shareUrl, text } = getAchievementSharePayload(type, { ...context, sport });
    window.open(getTwitterShareUrl(shareUrl, text), '_blank', 'noopener,noreferrer');
  }, [sport]);

  const openFacebook = useCallback((type: AchievementShareType, context: AchievementShareContext) => {
    const { facebookUrl } = getAchievementSharePayload(type, { ...context, sport });
    window.open(facebookUrl, '_blank', 'noopener,noreferrer');
  }, [sport]);

  const openReddit = useCallback((type: AchievementShareType, context: AchievementShareContext) => {
    const { shareUrl, title } = getAchievementSharePayload(type, { ...context, sport });
    window.open(getRedditShareUrl(shareUrl, title), '_blank', 'noopener,noreferrer');
  }, [sport]);

  const handleShare = useCallback(
    (type: AchievementShareType, context: AchievementShareContext) => {
      const { shareUrl, title, twitterUrl } = getAchievementSharePayload(type, { ...context, sport });
      if (navigator.share && navigator.canShare?.({ title, url: shareUrl })) {
        navigator.share({
          title,
          url: shareUrl,
          text: title,
        }).then(() => toast.success('Shared')).catch(() => {
          window.open(twitterUrl, '_blank', 'noopener,noreferrer');
        });
      } else {
        window.open(twitterUrl, '_blank', 'noopener,noreferrer');
      }
    },
    [sport]
  );

  const handleCopyLink = useCallback(
    async (type: AchievementShareType, context: AchievementShareContext) => {
      const { shareUrl } = getAchievementSharePayload(type, { ...context, sport });
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedId(type);
        toast.success('Link copied');
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        toast.error('Could not copy link');
      }
    },
    [sport]
  );

  const handleGenerateShareCard = useCallback(
    async (type: AchievementShareType, context: AchievementShareContext) => {
      setGeneratingCard(true);
      try {
        const res = await fetch('/api/share/moment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareType: type, sport, ...context }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setShareId(data.shareId);
        setApprovedForPublish(false);
        setPreview({
          shareUrl:
            data.shareUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${data.shareId}`,
          title: data.title,
          caption: data.summary,
        });
        await loadPublishLogs(data.shareId);
        toast.success('Share card created');
      } catch {
        toast.error('Could not create share card');
      } finally {
        setGeneratingCard(false);
      }
    },
    [sport, loadPublishLogs]
  );

  const handleGenerateCopy = useCallback(
    async (type: AchievementShareType, context: AchievementShareContext) => {
      setGeneratingCopy(true);
      try {
        const res = await fetch('/api/share/generate-copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareType: type, sport, shareId, ...context }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        const fallbackUrl = getAchievementSharePayload(type, { ...context, sport }).shareUrl;
        const shareUrl = shareId
          ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${shareId}`
          : fallbackUrl;
        setPreview({
          shareUrl,
          title: data.headline ?? 'Viral share',
          caption: data.caption ?? '',
          cta: data.cta ?? '',
          hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
        });
        toast.success(data.fromGrok ? 'Grok copy generated' : 'Copy generated');
      } catch {
        toast.error('Could not generate copy');
      } finally {
        setGeneratingCopy(false);
      }
    },
    [sport, shareId]
  );

  const handlePreviewCard = useCallback(
    async (type: AchievementShareType, context: AchievementShareContext) => {
      if (!shareId) {
        const payload = getAchievementSharePayload(type, { ...context, sport });
        setPreview({
          shareUrl: payload.shareUrl,
          title: payload.title,
          caption: payload.text,
        });
        return;
      }
      setLoadingAction('preview');
      try {
        const res = await fetch(`/api/share/preview?shareId=${encodeURIComponent(shareId)}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load preview');
        setPreview({
          shareUrl: String(data.shareUrl ?? ''),
          title: String(data.title ?? ''),
          caption: String(data.caption ?? ''),
          cta: typeof data.cta === 'string' ? data.cta : undefined,
          hashtags: Array.isArray(data.hashtags)
            ? data.hashtags.filter((tag: unknown): tag is string => typeof tag === 'string')
            : undefined,
        });
        setApprovedForPublish(!!data.approvedForPublish);
      } catch {
        toast.error('Could not load preview');
      } finally {
        setLoadingAction(null);
      }
    },
    [shareId, sport]
  );

  const handleCopyCaption = useCallback(async (caption: string, type: string) => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedCaptionId(type);
      toast.success('Caption copied');
      setTimeout(() => setCopiedCaptionId(null), 2000);
    } catch {
      toast.error('Could not copy caption');
    }
  }, []);

  const handlePublish = useCallback(async (platform: string) => {
    if (!shareId) {
      toast.error('Create a share card first');
      return;
    }
    if (!approvedForPublish) {
      toast.error('Approve the share before publishing');
      return;
    }
    setPublishLoading(true);
    try {
      const res = await fetch('/api/share/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', shareId, platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (Array.isArray(data.logs)) setLogs(data.logs as PublishLog[]);
      if (data.status === 'provider_unavailable') {
        toast.info(data.message ?? 'Posting not configured yet');
      } else if (data.status === 'success') {
        toast.success('Published successfully');
      } else if (data.status === 'failed') {
        toast.error(data.message ?? 'Publish failed');
      } else {
        toast.success('Publish requested');
      }
    } catch {
      toast.error('Publish failed');
    } finally {
      setPublishLoading(false);
    }
  }, [shareId, approvedForPublish]);

  const handleRetry = useCallback(
    async (logId: string) => {
      setLoadingAction(`retry-${logId}`);
      try {
        const res = await fetch('/api/share/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'retry', logId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Retry failed');
        toast.success('Retry requested');
        await loadPublishLogs();
      } catch {
        toast.error('Retry failed');
      } finally {
        setLoadingAction(null);
      }
    },
    [loadPublishLogs]
  );

  const handleConnectAccount = useCallback(
    async (platform: string, action: 'connect' | 'disconnect') => {
      setLoadingAction(`${action}-${platform}`);
      try {
        const res = await fetch('/api/share/targets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 503) {
            toast.info(data.error ?? 'Provider not configured');
            return;
          }
          throw new Error(data.error || 'Failed to update account');
        }
        setTargets(Array.isArray(data.targets) ? (data.targets as Target[]) : []);
        toast.success(action === 'connect' ? 'Account connected' : 'Account disconnected');
      } catch {
        toast.error('Could not update account connection');
      } finally {
        setLoadingAction(null);
      }
    },
    []
  );

  const handleToggleAutoPost = useCallback(async (platform: string, enabled: boolean) => {
    setLoadingAction(`auto-${platform}`);
    try {
      const res = await fetch('/api/share/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, action: 'toggle_auto_post', autoPostingEnabled: enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update auto-post');
      setTargets(Array.isArray(data.targets) ? (data.targets as Target[]) : []);
      toast.success(enabled ? 'Auto-post enabled' : 'Auto-post disabled');
    } catch {
      toast.error('Could not update auto-post');
    } finally {
      setLoadingAction(null);
    }
  }, []);

  const handleApprove = useCallback(
    async (approved: boolean) => {
      if (!shareId) {
        toast.error('Create a share card first');
        return;
      }
      setLoadingAction('approve');
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(shareId)}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to update approval');
        setApprovedForPublish(approved);
        if (Array.isArray(data.logs)) setLogs(data.logs as PublishLog[]);
        if (approved && Array.isArray(data.autoPublishResults) && data.autoPublishResults.length > 0) {
          toast.success('Approved and auto-publish triggered');
        } else {
          toast.success(approved ? 'Approved for publish' : 'Approval revoked');
        }
      } catch {
        toast.error('Could not update approval');
      } finally {
        setLoadingAction(null);
      }
    },
    [shareId]
  );

  const handleMobileShare = useCallback(async () => {
    if (!preview) return;
    if (navigator.share && navigator.canShare?.({ title: preview.title, url: preview.shareUrl })) {
      try {
        await navigator.share({
          title: preview.title,
          text: preview.caption,
          url: preview.shareUrl,
        });
        toast.success('Shared');
        return;
      } catch {
        toast.error('Could not share');
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(preview.shareUrl);
      toast.success('Link copied');
    } catch {
      toast.error('Could not share');
    }
  }, [preview]);

  const closePreview = useCallback(() => {
    setPreview(null);
  }, []);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-4">
        <Link
          href="/app"
          className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:underline"
          data-audit="back-button"
          data-testid="share-achievement-back-button"
        >
          Back
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-white">Share your achievements</h1>
        <p className="mt-1 text-sm text-white/60">
          Generate share cards and Grok-powered copy. Share to X, Facebook, or copy link/caption.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-white/60">Sport</label>
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className="rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-white text-sm"
          data-audit="sport-selector"
          data-testid="share-achievement-sport-selector"
        >
          {SUPPORTED_SPORTS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {preview && (
        <Card className="border-cyan-500/30 bg-cyan-950/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base text-white">Preview</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={closePreview}
              className="text-white/70"
              data-audit="close-preview-button"
              data-testid="share-achievement-close-preview-button"
            >
              Close
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-white">{preview.title}</p>
            <p className="text-xs text-white/70 whitespace-pre-wrap">{preview.caption}</p>
            {preview.hashtags && preview.hashtags.length > 0 ? (
              <p className="text-xs text-cyan-200">
                {preview.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ')}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-white/70">Platform</label>
              <select
                value={selectedPlatform}
                onChange={(event) => setSelectedPlatform(event.target.value)}
                className="rounded-lg border border-white/20 bg-black/30 px-2 py-1 text-xs text-white"
                data-testid="share-achievement-platform-selector"
                data-audit="platform-selector"
              >
                {SUPPORTED_PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
              <span className="text-xs text-white/50">
                {selectedTarget?.connected
                  ? `Connected${selectedTarget.accountIdentifier ? ` (${selectedTarget.accountIdentifier})` : ''}`
                  : 'Not connected'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(preview.shareUrl);
                    toast.success('Link copied');
                  } catch {
                    toast.error('Could not copy link');
                  }
                }}
                className="gap-1.5 border-white/20"
                data-audit="copy-link-button-preview"
                data-testid="share-achievement-preview-copy-link-button"
              >
                <Copy className="h-3.5 w-3.5" /> Copy link
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopyCaption(preview.caption, 'preview')}
                className="gap-1.5 border-white/20"
                data-audit="copy-caption-button"
                data-testid="share-achievement-copy-caption-button"
              >
                {copiedCaptionId === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedCaptionId === 'preview' ? 'Copied!' : 'Copy caption'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMobileShare}
                className="gap-1.5 border-white/20"
                data-audit="mobile-share-sheet-button"
                data-testid="share-achievement-mobile-share-button"
              >
                <Share2 className="h-3.5 w-3.5" />
                Mobile share
              </Button>
              {!selectedTarget?.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleConnectAccount(selectedPlatform, 'connect')}
                  className="gap-1.5 border-white/20"
                  data-audit="connect-account-button"
                  data-testid={`share-achievement-connect-account-button-${selectedPlatform}`}
                >
                  {loadingAction === `connect-${selectedPlatform}` ? 'Connecting...' : 'Connect account'}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleConnectAccount(selectedPlatform, 'disconnect')}
                  className="gap-1.5 border-white/20"
                  data-audit="connect-account-button"
                  data-testid={`share-achievement-disconnect-account-button-${selectedPlatform}`}
                >
                  {loadingAction === `disconnect-${selectedPlatform}` ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              )}
              <label className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-2 py-1 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={!!selectedTarget?.autoPostingEnabled}
                  disabled={!selectedTarget?.connected}
                  onChange={(event) => void handleToggleAutoPost(selectedPlatform, event.target.checked)}
                  data-audit="auto-post-toggle"
                  data-testid={`share-achievement-auto-post-toggle-${selectedPlatform}`}
                />
                Auto-post
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleApprove(!approvedForPublish)}
                disabled={!shareId}
                className="gap-1.5 border-white/20"
                data-audit="approve-for-publish-button"
                data-testid="share-achievement-approve-publish-button"
              >
                {loadingAction === 'approve' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Target className="h-3.5 w-3.5" />
                )}
                {approvedForPublish ? 'Revoke approval' : 'Approve for publish'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePublish(selectedPlatform)}
                disabled={publishLoading}
                className="gap-1.5 border-white/20"
                data-audit="publish-now-button"
                data-testid="share-achievement-publish-now-button"
              >
                {publishLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Publish now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadPublishLogs()}
                disabled={!shareId}
                className="gap-1.5 border-white/20"
                data-audit="status-refresh-button"
                data-testid="share-achievement-status-refresh-button"
              >
                Refresh status
              </Button>
              {retryableLog ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRetry(retryableLog.id)}
                  className="gap-1.5 border-white/20"
                  data-audit="retry-publish-button"
                  data-testid={`share-achievement-retry-publish-button-${retryableLog.id}`}
                >
                  {loadingAction === `retry-${retryableLog.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Retry publish
                </Button>
              ) : null}
            </div>
            <ul className="space-y-1 text-xs text-white/60">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center gap-2">
                  <span className="inline-flex min-w-[70px] capitalize">{log.platform}</span>
                  <span className="inline-flex min-w-[140px]">{log.status}</span>
                  <span className="text-white/40">{new Date(log.createdAt).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {(ACHIEVEMENT_SHARE_TYPES as unknown as AchievementShareType[]).map((type) => {
          const context = getDefaultContext(type);
          const Icon = TYPE_ICONS[type] ?? Trophy;
          const label = TYPE_LABELS[type] ?? type;
          return (
            <Card key={type} className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-white">
                  <Icon className="h-5 w-5 text-amber-400" />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerateShareCard(type, context)}
                  disabled={generatingCard}
                  className="gap-2 border-white/20"
                  data-audit="generate-share-card-button"
                  data-share-type={type}
                  data-testid={`share-achievement-generate-share-card-button-${type}`}
                >
                  {generatingCard ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  Generate share card
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerateCopy(type, context)}
                  disabled={generatingCopy}
                  className="gap-2 border-white/20"
                  data-audit="generate-copy-button"
                  data-share-type={type}
                  data-testid={`share-achievement-generate-social-copy-button-${type}`}
                >
                  {generatingCopy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Generate copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePreviewCard(type, context)}
                  className="gap-2 border-white/20"
                  data-audit="preview-card-button"
                  data-share-type={type}
                  data-testid={`share-achievement-preview-card-button-${type}`}
                >
                  Preview card
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleShare(type, context)}
                  className="gap-2 border-white/20"
                  data-audit="share-button"
                  data-share-type={type}
                  data-testid={`share-achievement-share-button-${type}`}
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openTwitter(type, context)}
                  className="gap-2 border-white/20"
                  data-audit="share-button-twitter"
                  data-testid={`share-achievement-share-button-x-${type}`}
                >
                  Post to X
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openFacebook(type, context)}
                  className="gap-2 border-white/20"
                  data-audit="share-button-facebook"
                  data-testid={`share-achievement-share-button-facebook-${type}`}
                >
                  Share on Facebook
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openReddit(type, context)}
                  className="gap-2 border-white/20"
                  data-audit="share-button-reddit"
                  data-testid={`share-achievement-share-button-reddit-${type}`}
                >
                  Share on Reddit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyLink(type, context)}
                  className="gap-2 border-white/20"
                  data-audit="copy-link-button"
                  data-share-type={type}
                  data-testid={`share-achievement-copy-link-button-${type}`}
                >
                  {copiedId === type ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedId === type ? 'Copied!' : 'Copy link'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-white/50">
        Generate a share card and Grok copy, preview before posting, and optionally auto-post to connected accounts after approval.
      </p>
    </main>
  );
}
