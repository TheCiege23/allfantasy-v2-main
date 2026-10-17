"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, Eye, Save, Send, Loader2, CalendarClock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEOFields } from "@/components/blog/SEOFields";
import { InternalLinkSuggestionPanel } from "@/components/blog/InternalLinkSuggestionPanel";
import { BLOG_CATEGORY_LABELS } from "@/lib/automated-blog/types";
import type { BlogCategory } from "@/lib/automated-blog/types";
import { renderBlogBodyHtml } from "@/lib/automated-blog/renderBlogBody";
import { toast } from "sonner";

type Article = {
  articleId: string;
  title: string;
  slug: string;
  sport: string;
  category: string;
  excerpt: string | null;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: string[];
  publishStatus: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PublishLog = {
  publishId: string;
  actionType: string;
  status: string;
  createdAt: string;
};

export default function BlogDraftEditorPage() {
  const params = useParams<{ articleId: string }>() ?? ({} as { articleId: string });
  const router = useRouter();
  const articleId = params?.articleId ?? "";
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"preview" | "edit">("edit");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSeoPreview, setShowSeoPreview] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [publishLogs, setPublishLogs] = useState<PublishLog[]>([]);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [body, setBody] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const fetchArticle = useCallback(async () => {
    if (!articleId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/blog/${encodeURIComponent(articleId)}`);
      if (!r.ok) throw new Error("Not found");
      const data = await r.json();
      const a = data.article;
      setArticle(a);
      setTitle(a.title ?? "");
      setSlug(a.slug ?? "");
      setExcerpt(a.excerpt ?? "");
      setBody(a.body ?? "");
      setSeoTitle(a.seoTitle ?? a.title ?? "");
      setSeoDescription(a.seoDescription ?? a.excerpt ?? "");
      setTags(Array.isArray(a.tags) ? a.tags : []);
      if (a.publishStatus === "scheduled" && a.publishedAt) {
        const dt = new Date(a.publishedAt);
        const year = dt.getFullYear();
        const month = `${dt.getMonth() + 1}`.padStart(2, "0");
        const day = `${dt.getDate()}`.padStart(2, "0");
        const hours = `${dt.getHours()}`.padStart(2, "0");
        const minutes = `${dt.getMinutes()}`.padStart(2, "0");
        setScheduleAt(`${year}-${month}-${day}T${hours}:${minutes}`);
      }
    } catch {
      setArticle(null);
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  const fetchPublishState = useCallback(async () => {
    if (!articleId) return;
    try {
      const r = await fetch(`/api/blog/${encodeURIComponent(articleId)}/publish`, { cache: "no-store" });
      const data = await r.json();
      if (data.article) {
        setArticle((prev) =>
          prev
            ? {
                ...prev,
                publishStatus: data.article.publishStatus ?? prev.publishStatus,
                publishedAt: data.article.publishedAt ?? prev.publishedAt,
              }
            : prev
        );
      }
      if (Array.isArray(data.logs)) {
        setPublishLogs(data.logs as PublishLog[]);
      }
    } catch {
      setPublishLogs([]);
    }
  }, [articleId]);

  useEffect(() => {
    void fetchArticle();
  }, [fetchArticle]);

  useEffect(() => {
    void fetchPublishState();
  }, [fetchPublishState]);

  const handleSaveDraft = () => {
    setSaving(true);
    fetch(`/api/blog/${encodeURIComponent(articleId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        slug,
        excerpt,
        body,
        seoTitle,
        seoDescription,
        tags,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.article) {
          setArticle(data.article);
          setSlug(data.article.slug ?? slug);
          toast.success("Draft saved");
        } else if (data.ok) {
          toast.success("Draft saved");
          fetchArticle();
        } else toast.error(data.error ?? "Save failed");
      })
      .catch(() => toast.error("Save failed"))
      .finally(() => setSaving(false));
  };

  const handlePublish = () => {
    setPublishing(true);
    fetch(`/api/blog/${encodeURIComponent(articleId)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          toast.success("Published");
          fetchArticle();
          fetchPublishState();
        } else toast.error(data.error ?? "Publish failed");
      })
      .catch(() => toast.error("Publish failed"))
      .finally(() => setPublishing(false));
  };

  const handleSchedulePublish = () => {
    if (!scheduleAt) {
      toast.error("Select a schedule date/time");
      return;
    }
    setScheduling(true);
    fetch(`/api/blog/${encodeURIComponent(articleId)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "schedule", scheduledAt: new Date(scheduleAt).toISOString() }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          toast.success("Publish scheduled");
          fetchArticle();
          fetchPublishState();
        } else toast.error(data.error ?? "Schedule failed");
      })
      .catch(() => toast.error("Schedule failed"))
      .finally(() => setScheduling(false));
  };

  const handleUnpublish = () => {
    setUnpublishing(true);
    fetch(`/api/blog/${encodeURIComponent(articleId)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unpublish" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          toast.success("Moved back to draft");
          fetchArticle();
          fetchPublishState();
        } else toast.error(data.error ?? "Unpublish failed");
      })
      .catch(() => toast.error("Unpublish failed"))
      .finally(() => setUnpublishing(false));
  };

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.all([fetchArticle(), fetchPublishState()]).finally(() => setRefreshing(false));
  };

  if (loading && !article) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-gray-950 text-white px-4 py-10">
        <p className="text-zinc-400">Article not found.</p>
        <Link href="/admin" className="mt-2 inline-block text-cyan-400 hover:underline">
          Back to admin
        </Link>
      </div>
    );
  }

  const isDraft = article.publishStatus === "draft";
  const bodyHtml = renderBlogBodyHtml(tab === "preview" ? body : article.body);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white"
            data-testid="blog-draft-back-button"
          >
            <ArrowLeft className="h-4 w-4" /> Back to admin
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="gap-1"
              data-testid="blog-draft-refresh-button"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button
              variant={tab === "edit" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("edit")}
              className="gap-1"
              data-testid="blog-draft-edit-tab-button"
            >
              <FileText className="h-4 w-4" /> Edit
            </Button>
            <Button
              variant={tab === "preview" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("preview")}
              className="gap-1"
              data-testid="blog-draft-preview-tab-button"
            >
              <Eye className="h-4 w-4" /> Preview
            </Button>
          </div>
        </div>

        <header className="mb-6">
          <span className="text-xs uppercase text-gray-500">
            {article.sport} · {BLOG_CATEGORY_LABELS[article.category as BlogCategory] ?? article.category}
          </span>
          <h1 className="mt-1 text-2xl font-bold">
            {title || article.title}
          </h1>
          <p className="mt-1 text-xs text-zinc-500" data-testid="blog-draft-slug-preview">
            Slug preview: /blog/{slug || article.slug}
          </p>
          {article.publishStatus !== "draft" && (
            <span className="mt-2 inline-block rounded px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-300">
              {article.publishStatus}
            </span>
          )}
        </header>

        {tab === "preview" ? (
          <div className="space-y-6" data-testid="blog-draft-preview-panel">
            {(excerpt || article.excerpt) && (
              <p className="text-gray-400">{excerpt || article.excerpt}</p>
            )}
            <div
              className="blog-body prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
              data-testid="blog-draft-preview-body"
            />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr,280px]">
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
                  data-testid="blog-draft-title-input"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Slug</label>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white font-mono text-sm"
                  data-testid="blog-draft-slug-input"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Excerpt</label>
                <textarea
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
                  data-testid="blog-draft-excerpt-input"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Body (markdown)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white font-mono text-sm"
                  data-testid="blog-draft-body-input"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowSeoPreview((value) => !value)}
                className="text-xs text-amber-400 hover:underline"
                data-testid="blog-draft-seo-preview-toggle"
              >
                {showSeoPreview ? "Hide" : "Show"} SEO preview
              </button>
              {showSeoPreview && (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-zinc-300" data-testid="blog-draft-seo-preview-panel">
                  <p><strong>SEO title:</strong> {seoTitle}</p>
                  <p><strong>SEO description:</strong> {seoDescription}</p>
                  <p><strong>Canonical:</strong> https://allfantasy.ai/blog/{slug || article.slug}</p>
                </div>
              )}
              <SEOFields
                seoTitle={seoTitle}
                seoDescription={seoDescription}
                tags={tags}
                onChange={({ seoTitle: s, seoDescription: d, tags: t }) => {
                  setSeoTitle(s);
                  setSeoDescription(d);
                  setTags(t);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="gap-2"
                  data-testid="blog-draft-save-button"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save draft
                </Button>
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(event) => setScheduleAt(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs text-white"
                    data-testid="blog-draft-schedule-input"
                  />
                  <Button
                    variant="outline"
                    onClick={handleSchedulePublish}
                    disabled={scheduling}
                    className="gap-2"
                    data-testid="blog-draft-schedule-publish-button"
                  >
                    {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                    Schedule
                  </Button>
                </div>
                {isDraft && (
                  <Button
                    variant="default"
                    onClick={handlePublish}
                    disabled={publishing}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-500"
                    data-testid="blog-draft-publish-button"
                  >
                    {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Publish
                  </Button>
                )}
                {!isDraft && (
                  <Button
                    variant="outline"
                    onClick={handleUnpublish}
                    disabled={unpublishing}
                    className="gap-2"
                    data-testid="blog-draft-unpublish-button"
                  >
                    {unpublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
                    Move to draft
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => router.push(`/blog/${slug || article.slug}?preview=1`)}
                  className="gap-2 sm:hidden"
                  data-testid="blog-draft-mobile-preview-action"
                >
                  <Eye className="h-4 w-4" />
                  Mobile preview
                </Button>
              </div>
              {publishLogs.length > 0 && (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3" data-testid="blog-draft-publish-log-panel">
                  <p className="text-xs font-medium text-zinc-300 mb-2">Publish logs</p>
                  <ul className="space-y-1">
                    {publishLogs.map((log) => (
                      <li key={log.publishId} className="text-xs text-zinc-400">
                        {log.actionType} · {log.status} · {new Date(log.createdAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <InternalLinkSuggestionPanel articleId={articleId} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
