"use client";

interface SEOFieldsProps {
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  onChange: (data: { seoTitle: string; seoDescription: string; tags: string[] }) => void;
  disabled?: boolean;
  className?: string;
}

const TITLE_MAX = 60;
const DESC_MAX = 160;

export function SEOFields({
  seoTitle,
  seoDescription,
  tags,
  onChange,
  disabled = false,
  className = "",
}: SEOFieldsProps) {
  const tagsStr = Array.isArray(tags) ? tags.join(", ") : "";

  return (
    <div className={`space-y-3 ${className}`}>
      <h3 className="text-sm font-medium text-zinc-400">SEO</h3>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Meta title (max {TITLE_MAX})</label>
        <input
          type="text"
          value={seoTitle}
          onChange={(e) => onChange({ seoTitle: e.target.value.slice(0, TITLE_MAX), seoDescription, tags })}
          maxLength={TITLE_MAX}
          disabled={disabled}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-zinc-500 disabled:opacity-50"
          placeholder="SEO title"
          data-testid="blog-seo-title-input"
        />
        <p className="text-xs text-zinc-500 mt-0.5">{seoTitle.length}/{TITLE_MAX}</p>
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Meta description (max {DESC_MAX})</label>
        <textarea
          value={seoDescription}
          onChange={(e) => onChange({ seoTitle, seoDescription: e.target.value.slice(0, DESC_MAX), tags })}
          maxLength={DESC_MAX}
          rows={2}
          disabled={disabled}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-zinc-500 disabled:opacity-50"
          placeholder="Meta description"
          data-testid="blog-seo-description-input"
        />
        <p className="text-xs text-zinc-500 mt-0.5">{seoDescription.length}/{DESC_MAX}</p>
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Tags (comma-separated)</label>
        <input
          type="text"
          value={tagsStr}
          onChange={(e) => {
            const next = e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
            onChange({ seoTitle, seoDescription, tags: next });
          }}
          disabled={disabled}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-zinc-500 disabled:opacity-50"
          placeholder="tag1, tag2, tag3"
          data-testid="blog-seo-tags-input"
        />
      </div>
    </div>
  );
}
