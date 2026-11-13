"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import type { InternalLinkSuggestion } from "@/lib/automated-blog/types";

interface InternalLinkSuggestionPanelProps {
  articleId: string;
  className?: string;
}

export function InternalLinkSuggestionPanel({ articleId, className = "" }: InternalLinkSuggestionPanelProps) {
  const [suggestions, setSuggestions] = useState<InternalLinkSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSuggestions = () => {
    if (!articleId) return;
    setLoading(true);
    fetch(`/api/blog/${encodeURIComponent(articleId)}/internal-links`)
      .then((r) => r.json())
      .then((data) => (data.suggestions ? setSuggestions(data.suggestions) : []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSuggestions();
  }, [articleId]);

  return (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-4 ${className}`} data-testid="blog-internal-link-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-400">Suggested internal links</h3>
        <button
          type="button"
          onClick={loadSuggestions}
          className="rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
          data-testid="blog-internal-link-refresh-button"
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : suggestions.length === 0 ? (
        <p className="text-xs text-zinc-500">No suggestions for this article.</p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s, i) => (
            <li key={`${s.href}-${i}`}>
              <Link
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300"
                data-testid={`blog-internal-link-item-${i}`}
              >
                <span>{s.anchor}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              {s.reason && (
                <span className="ml-2 text-xs text-zinc-500">{s.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
