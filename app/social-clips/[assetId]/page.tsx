'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Check,
  X,
  Copy,
  Send,
  RefreshCw,
  ImagePlus,
  Pencil,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SUPPORTED_PLATFORMS } from '@/lib/social-clips-grok/types';
import { toast } from 'sonner';
import { useUserTimezone } from '@/hooks/useUserTimezone';

interface AssetMeta {
  shortCaption?: string;
  shortScriptOverlay?: string;
  headline?: string;
  ctaText?: string;
  hashtags?: string[];
  socialCardCopy?: string;
  clipTitle?: string;
  platformVariants?: Record<string, { caption: string; hashtags: string[] }>;
}

interface Asset {
  id: string;
  sport: string;
  assetType: string;
  title: string;
  contentBody: string;
  provider: string | null;
  approvedForPublish: boolean;
  metadata: AssetMeta;
  createdAt: string;
}

interface Target {
  platform: string;
  accountIdentifier: string | null;
  autoPostingEnabled: boolean;
  connected: boolean;
  providerConfigured: boolean;
}

interface LogEntry {
  id: string;
  platform: string;
  status: string;
  responseMetadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function SocialClipDetailPage() {
  const { formatInTimezone } = useUserTimezone();
  const params = useParams<{ assetId: string }>() ?? ({} as { assetId: string });
  const assetId = params?.assetId ?? '';
  const [asset, setAsset] = useState<Asset | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('x');
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editShortCaption, setEditShortCaption] = useState('');
  const [editShortScriptOverlay, setEditShortScriptOverlay] = useState('');
  const [editHeadline, setEditHeadline] = useState('');
  const [editCtaText, setEditCtaText] = useState('');
  const [editSocialCardCopy, setEditSocialCardCopy] = useState('');
  const [editClipTitle, setEditClipTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAsset = useCallback(() => {
    if (!assetId) return;
    setLoading(true);
    fetch(`/api/social-clips/${encodeURIComponent(assetId)}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : 'Failed');
        return r.json();
      })
      .then(setAsset)
      .catch(() => setAsset(null))
      .finally(() => setLoading(false));
  }, [assetId]);

  const fetchTargets = useCallback(() => {
    fetch('/api/share/targets', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => (data?.targets ? setTargets(data.targets) : []))
      .catch(() => {});
  }, []);

  const fetchLogs = useCallback(() => {
    if (!assetId) return;
    fetch(`/api/social-clips/${assetId}/logs`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => (data?.logs ? setLogs(data.logs) : []))
      .catch(() => {});
  }, [assetId]);

  useEffect(() => {
    fetchAsset();
  }, [fetchAsset]);

  useEffect(() => {
    if (asset) {
      setEditTitle(asset.title);
      const m = asset.metadata ?? {};
      setEditShortCaption(m.shortCaption ?? '');
      setEditShortScriptOverlay(m.shortScriptOverlay ?? '');
      setEditHeadline(m.headline ?? '');
      setEditCtaText(m.ctaText ?? '');
      setEditSocialCardCopy(m.socialCardCopy ?? '');
      setEditClipTitle(m.clipTitle ?? '');
    }
  }, [asset]);
  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);
  useEffect(() => {
    if (assetId) fetchLogs();
  }, [assetId, fetchLogs]);

  const handleApprove = (approved: boolean) => {
    setActionLoading('approve');
    fetch(`/api/social-clips/${assetId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved }),
    })
      .then((r) => r.json())
      .then((data) => {
        fetchAsset();
        fetchLogs();
        if (approved) {
          const autoCount = Array.isArray(data?.autoPublishResults) ? data.autoPublishResults.length : 0;
          if (autoCount > 0) {
            toast.success(`Approved. Auto-post triggered for ${autoCount} platform${autoCount === 1 ? '' : 's'}.`);
            return;
          }
        }
        toast.success(approved ? 'Approved for publish' : 'Approval revoked');
      })
      .catch(() => toast.error('Failed'))
      .finally(() => setActionLoading(null));
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => toast.error('Copy failed'));
  };

  const handlePublish = (platform: string) => {
    if (actionLoading !== null) return;
    setActionLoading(`publish-${platform}`);
    fetch(`/api/social-clips/${assetId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) toast.error(data.error);
        else toast.success(data?.message ?? 'Publish requested');
        fetchLogs();
        fetchAsset();
      })
      .catch(() => toast.error('Publish failed'))
      .finally(() => setActionLoading(null));
  };

  const handleRetry = (logId: string) => {
    if (actionLoading !== null) return;
    setActionLoading(`retry-${logId}`);
    fetch(`/api/social-clips/retry/${logId}`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) toast.error(data.error);
        else toast.success('Retry requested');
        fetchLogs();
      })
      .catch(() => toast.error('Retry failed'))
      .finally(() => setActionLoading(null));
  };

  const handleAutoPostToggle = (platform: string, enabled: boolean) => {
    setActionLoading(`auto-${platform}`);
    fetch('/api/share/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, action: 'toggle_auto_post', autoPostingEnabled: enabled }),
    })
      .then((r) => r.json())
      .then((data) => (data?.targets ? setTargets(data.targets) : null))
      .then(() => toast.success(enabled ? 'Auto-post on' : 'Auto-post off'))
      .catch(() => toast.error('Failed'))
      .finally(() => setActionLoading(null));
  };

  const handleConnectAccount = (platform: string) => {
    if (actionLoading !== null) return;
    setActionLoading(`connect-${platform}`);
    fetch('/api/share/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, action: 'connect' }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data?.error ?? 'Connect failed');
        }
        if (data?.targets) setTargets(data.targets);
        toast.success(`Connected ${platform}`);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Connect failed'))
      .finally(() => setActionLoading(null));
  };

  const handleDisconnectAccount = (platform: string) => {
    if (actionLoading !== null) return;
    setActionLoading(`disconnect-${platform}`);
    fetch('/api/share/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, action: 'disconnect' }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.targets) setTargets(data.targets);
        toast.success(`Disconnected ${platform}`);
      })
      .catch(() => toast.error('Disconnect failed'))
      .finally(() => setActionLoading(null));
  };

  const handleSaveEdit = () => {
    setSaving(true);
    const metadata = {
      ...(asset?.metadata ?? {}),
      shortCaption: editShortCaption,
      shortScriptOverlay: editShortScriptOverlay,
      headline: editHeadline,
      ctaText: editCtaText,
      socialCardCopy: editSocialCardCopy,
      clipTitle: editClipTitle,
    };
    fetch(`/api/social-clips/${assetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editTitle, metadata }),
    })
      .then((r) => r.json())
      .then(() => {
        toast.success('Saved');
        setEditMode(false);
        fetchAsset();
      })
      .catch(() => toast.error('Save failed'))
      .finally(() => setSaving(false));
  };

  const handleRegenerate = () => {
    setActionLoading('regenerate');
    const sport = asset?.sport ?? 'NFL';
    const assetType = asset?.assetType ?? 'weekly_league_winners';
    fetch('/api/social-clips/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sport, assetType }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) window.location.href = `/social-clips/${data.id}`;
        else setActionLoading(null);
      })
      .catch(() => setActionLoading(null));
  };

  const handleShareAsset = async () => {
    try {
      const url = `${window.location.origin}/social-clips/${assetId}`;
      const title = asset?.title ?? 'AllFantasy Social Clip';
      if (navigator.share && navigator.canShare?.({ title, url })) {
        await navigator.share({ title, url, text: title });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Share link copied');
    } catch {
      toast.error('Share failed');
    }
  };

  const handleDownloadAsset = () => {
    const payload = {
      id: asset?.id,
      sport: asset?.sport,
      assetType: asset?.assetType,
      title: asset?.title,
      metadata: asset?.metadata ?? {},
      createdAt: asset?.createdAt,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `allfantasy-social-clip-${assetId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleMobileQuickPublish = () => {
    if (!asset?.approvedForPublish) {
      toast.error('Approve this clip before publishing');
      return;
    }
    const prioritized =
      targets.find((target) => target.connected && target.autoPostingEnabled) ??
      targets.find((target) => target.connected);
    if (!prioritized) {
      toast.error('Connect a platform first');
      return;
    }
    void handlePublish(prioritized.platform);
  };

  const meta = asset?.metadata ?? {};
  const variant = meta.platformVariants?.[selectedPlatform];
  const selectedHashtags = Array.isArray(variant?.hashtags)
    ? variant.hashtags
    : Array.isArray(meta.hashtags)
      ? meta.hashtags
      : [];
  const caption = editMode ? editShortCaption : (variant?.caption ?? meta.shortCaption ?? '');
  const headline = editMode ? editHeadline : (meta.headline ?? '');
  const hashtags = selectedHashtags.join(' ');
  const fullCaption = [caption, hashtags].filter(Boolean).join('\n');

  if (loading && !asset) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <p className="text-zinc-400">Clip not found.</p>
        <Link href="/social-clips" className="mt-2 inline-block text-cyan-400 hover:underline">
          Back to social clips
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex items-center gap-4">
        <Link
          href="/social-clips"
          className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:underline"
          data-testid="social-clip-back-button"
          data-audit="back-button"
        >
          <ArrowLeft className="h-4 w-4" /> Back to social clips
        </Link>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">Platform preview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_PLATFORMS.map((platform) => (
            <Button
              key={platform}
              size="sm"
              variant={selectedPlatform === platform ? 'default' : 'outline'}
              onClick={() => setSelectedPlatform(platform)}
              data-testid={`social-clip-platform-selection-button-${platform}`}
              data-audit="platform-selection-button"
            >
              {platform}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h1 className="text-lg font-semibold text-white">{asset.title}</h1>
        <p className="text-xs text-zinc-500 mt-1">
          {asset.sport} · {asset.assetType} · {formatInTimezone(asset.createdAt)}
        </p>
      </div>

      {/* Preview content / Edit mode */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-400">{editMode ? 'Edit' : 'Preview'}</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowPreview((current) => !current)}
            disabled={editMode}
            data-testid="social-clip-preview-content-button"
            data-audit="preview-content-button"
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>
          {editMode ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(false)}
                data-testid="social-clip-edit-cancel-button"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveEdit}
                disabled={saving}
                className="gap-1"
                data-testid="social-clip-edit-save-button"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditMode(true)}
              className="gap-1"
              data-testid="social-clip-edit-mode-button"
              data-audit="edit-mode-button"
            >
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
        </div>
        {editMode ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500">Title</label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                data-testid="social-clip-edit-title-input"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Script overlay</label>
              <input
                value={editShortScriptOverlay}
                onChange={(e) => setEditShortScriptOverlay(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                data-testid="social-clip-edit-script-overlay-input"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Headline</label>
              <input
                value={editHeadline}
                onChange={(e) => setEditHeadline(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                data-testid="social-clip-edit-headline-input"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Caption</label>
              <textarea
                value={editShortCaption}
                onChange={(e) => setEditShortCaption(e.target.value)}
                rows={3}
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                data-testid="social-clip-edit-caption-input"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">CTA</label>
              <input
                value={editCtaText}
                onChange={(e) => setEditCtaText(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                data-testid="social-clip-edit-cta-input"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Card copy</label>
              <input
                value={editSocialCardCopy}
                onChange={(e) => setEditSocialCardCopy(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                data-testid="social-clip-edit-card-copy-input"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Clip title</label>
              <input
                value={editClipTitle}
                onChange={(e) => setEditClipTitle(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                data-testid="social-clip-edit-clip-title-input"
              />
            </div>
          </div>
        ) : showPreview ? (
          <>
            {headline && <p className="text-white font-medium">{headline}</p>}
            {meta.shortScriptOverlay && (
              <p className="text-xs uppercase tracking-wide text-cyan-300">{meta.shortScriptOverlay}</p>
            )}
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{caption}</p>
            {meta.ctaText && <p className="text-sm text-cyan-400">{meta.ctaText}</p>}
            {hashtags && <p className="text-xs text-zinc-500">{hashtags}</p>}
          </>
        ) : (
          <p className="text-sm text-zinc-500">Preview hidden</p>
        )}
      </div>

      {/* Copy buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => copyText(fullCaption, 'Caption')}
          className="gap-1"
          data-testid="social-clip-copy-caption-button"
          data-audit="copy-caption-button"
        >
          <Copy className="h-4 w-4" /> Copy caption
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => copyText(caption, 'Text')}
          className="gap-1"
          data-testid="social-clip-copy-text-button"
          data-audit="copy-text-button"
        >
          <Copy className="h-4 w-4" /> Copy text
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleShareAsset()}
          className="gap-1"
          data-testid="social-clip-share-asset-button"
          data-audit="share-asset-button"
        >
          <Send className="h-4 w-4" /> Share asset
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadAsset}
          className="gap-1"
          data-testid="social-clip-download-asset-button"
          data-audit="download-asset-button"
        >
          <Save className="h-4 w-4" /> Download asset
        </Button>
      </div>

      {/* Approve */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Approve for publish:</span>
        {asset.approvedForPublish ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleApprove(false)}
            disabled={actionLoading === 'approve'}
            className="gap-1"
            data-testid="social-clip-approve-for-publish-button"
            data-audit="approve-for-publish-button"
          >
            {actionLoading === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Revoke
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => handleApprove(true)}
            disabled={actionLoading === 'approve'}
            className="gap-1"
            data-testid="social-clip-approve-for-publish-button"
            data-audit="approve-for-publish-button"
          >
            {actionLoading === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </Button>
        )}
      </div>

      {/* Connected targets & auto-post */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-400">Connected accounts & auto-post</h2>
        <p className="text-xs text-zinc-500">
          Connect accounts in settings. When auto-post is on, approved clips can be posted automatically (when provider is configured).
        </p>
        <ul className="space-y-2">
          {SUPPORTED_PLATFORMS.map((platform) => {
            const t = targets.find((x) => x.platform === platform);
            const connected = t?.connected ?? false;
            const autoOn = t?.autoPostingEnabled ?? false;
            return (
              <li key={platform} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                <span className="text-sm text-white capitalize">{platform}</span>
                <div className="flex items-center gap-2">
                  {!connected ? (
                    <>
                      <span className="text-xs text-zinc-500">
                        {t?.providerConfigured === false ? 'Provider unavailable' : 'Not connected'}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleConnectAccount(platform)}
                        disabled={actionLoading !== null}
                        data-testid={`social-clip-connect-social-account-button-${platform}`}
                        data-audit="connect-social-account-button"
                      >
                        {actionLoading === `connect-${platform}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Connect'
                        )}
                      </Button>
                    </>
                  ) : (
                    <>
                      <label className="flex items-center gap-1 text-xs text-zinc-400">
                        <input
                          type="checkbox"
                          checked={autoOn}
                          onChange={(e) => handleAutoPostToggle(platform, e.target.checked)}
                          disabled={!!actionLoading}
                          data-testid={`social-clip-auto-post-toggle-${platform}`}
                          data-audit="auto-post-toggle"
                        />
                        Auto-post
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDisconnectAccount(platform)}
                        disabled={actionLoading !== null}
                        data-testid={`social-clip-disconnect-social-account-button-${platform}`}
                      >
                        {actionLoading === `disconnect-${platform}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Disconnect'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePublish(platform)}
                        disabled={!asset.approvedForPublish || actionLoading !== null}
                        data-testid={`social-clip-publish-now-button-${platform}`}
                        data-audit="publish-now-button"
                      >
                        {actionLoading === `publish-${platform}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Publish now
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Publish logs & retry */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-400">Publish status</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchLogs}
            className="gap-1"
            data-testid="social-clip-status-refresh-button"
            data-audit="status-refresh-button"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
        {logs.length === 0 ? (
          <p className="text-xs text-zinc-500">No publish attempts yet.</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">{log.platform}</span>
                <span className={`text-xs ${log.status === 'success' ? 'text-emerald-400' : log.status === 'failed' || log.status === 'provider_unavailable' ? 'text-amber-400' : 'text-zinc-500'}`}>
                  {log.status}
                </span>
                <span className="text-xs text-zinc-500">{formatInTimezone(log.createdAt)}</span>
                {(log.status === 'failed' || log.status === 'provider_unavailable') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRetry(log.id)}
                    disabled={actionLoading !== null}
                    data-testid={`social-clip-retry-failed-publish-button-${log.id}`}
                    data-audit="retry-failed-publish-button"
                  >
                    {actionLoading === `retry-${log.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Retry'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Regenerate */}
      <Button
        variant="outline"
        onClick={handleRegenerate}
        disabled={actionLoading !== null}
        className="gap-2"
        data-testid="social-clip-regenerate-content-button"
        data-audit="regenerate-content-button"
      >
        {actionLoading === 'regenerate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        Regenerate new clip
      </Button>

      <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-0 right-0 z-20 px-4 sm:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-white/10 bg-black/70 p-2 backdrop-blur">
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => setShowPreview((current) => !current)}
            data-testid="social-clip-mobile-preview-action-button"
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>
          <Button
            className="flex-1"
            onClick={handleMobileQuickPublish}
            disabled={actionLoading !== null}
            data-testid="social-clip-mobile-publish-action-button"
          >
            Publish
          </Button>
        </div>
      </div>
    </div>
  );
}
