'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { FileDown, Trash2, PlusCircle } from 'lucide-react';
import type { LeagueTemplatePayload } from '@/lib/league-templates/types';

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  payload: LeagueTemplatePayload;
}

export default function LeagueTemplatesPanel({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [leagueName, setLeagueName] = useState('');

  useEffect(() => {
    fetch('/api/league/list')
      .then((r) => r.json())
      .then((data) => {
        const list = data?.leagues ?? data?.data ?? [];
        const league = list.find((l: { id?: string }) => l.id === leagueId);
        setLeagueName(league?.name ?? 'League');
      })
      .catch(() => {});
  }, [leagueId]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/leagues/templates')
      .then((r) => r.json())
      .then((data) => (Array.isArray(data.templates) ? setTemplates(data.templates) : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSaveAsTemplate = async () => {
    const name = saveName.trim() || leagueName.trim() || 'League template';
    setSaving(true);
    try {
      const res = await fetch('/api/leagues/templates/from-league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          name,
          description: saveDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save template');
        return;
      }
      toast.success('Template saved');
      setTemplates((prev) => [
        { id: data.id, name: data.name, description: data.description ?? null, payload: data.payload },
        ...prev,
      ]);
      setSaveName('');
      setSaveDescription('');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm('Delete this template?')) return;
    const res = await fetch(`/api/leagues/templates/${templateId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Failed to delete');
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    toast.success('Template deleted');
  };

  const handleUseTemplate = (templateId: string) => {
    router.push(`/create-league?template=${templateId}`);
  };

  // Rule templates library: share a template so other commissioners can start leagues from it.
  const isShared = (t: TemplateRow) => Boolean((t.payload as unknown as { share?: { public?: boolean } })?.share?.public);
  const handleShare = async (t: TemplateRow) => {
    const next = !isShared(t);
    const res = await fetch(`/api/leagues/templates/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? 'Failed to update sharing');
      return;
    }
    setTemplates((prev) =>
      prev.map((row) =>
        row.id === t.id
          ? { ...row, payload: { ...(row.payload as object), share: { ...((row.payload as unknown as { share?: object })?.share ?? {}), public: next } } as unknown as LeagueTemplatePayload }
          : row
      )
    );
    if (next) {
      const link = `${window.location.origin}/create-league?template=${t.id}`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      toast.success('Shared — it is in the template library, and the link is copied');
    } else {
      toast.success('No longer shared');
    }
  };

  return (
    <div className="space-y-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-base font-semibold text-white">League templates</h3>
      <p className="text-sm text-white/70">
        Save this league’s settings as a template to reuse when creating new leagues (draft, AI, automation, and all
        league settings).
      </p>

      <div className="space-y-3 rounded-lg border border-purple-600/30 bg-black/20 p-4">
        <Label className="text-white/80">Save this league as template</Label>
        <Input
          placeholder="Template name"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          data-testid="commissioner-template-name-input"
          className="max-w-xs bg-gray-900 border-white/20"
        />
        <Input
          placeholder="Description (optional)"
          value={saveDescription}
          onChange={(e) => setSaveDescription(e.target.value)}
          data-testid="commissioner-template-description-input"
          className="max-w-xs bg-gray-900 border-white/20"
        />
        <Button
          onClick={handleSaveAsTemplate}
          disabled={saving}
          data-testid="commissioner-template-save"
          className="bg-purple-600 hover:bg-purple-700"
        >
          <FileDown className="mr-2 h-4 w-4" />
          {saving ? 'Saving…' : 'Save as template'}
        </Button>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium text-white/90">My templates</h4>
          <a href="/league-templates" className="text-xs font-semibold text-purple-300 hover:text-purple-200">
            Browse shared templates
          </a>
        </div>
        {loading ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-white/50">No templates yet. Save this league as a template above.</p>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li
                key={t.id}
                data-testid={`commissioner-template-row-${t.id}`}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-gray-900/50 px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium text-white">{t.name}</span>
                  {t.description && (
                    <p className="text-xs text-white/50 truncate max-w-[200px]">{t.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/20 text-white/80"
                    onClick={() => handleShare(t)}
                    data-testid={`commissioner-template-share-${t.id}`}
                  >
                    {isShared(t) ? 'Shared' : 'Share'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-600/40 text-purple-300"
                    onClick={() => handleUseTemplate(t.id)}
                    data-testid={`commissioner-template-use-${t.id}`}
                  >
                    <PlusCircle className="mr-1 h-3 w-3" />
                    Use
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(t.id)}
                    data-testid={`commissioner-template-delete-${t.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
