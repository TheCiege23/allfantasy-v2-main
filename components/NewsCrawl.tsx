'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'

interface CrawlItem {
  id: string
  type: 'news' | 'injury'
  text: string
  source?: string
  url?: string | null
  team?: string | null
  timestamp: string
  priority: number
}

const POLL_INTERVAL = 180_000;

function timeAgo(ts: string): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NewsCrawl() {
  const [items, setItems] = useState<CrawlItem[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);
  const scrollPos = useRef(0);
  const prevItemsHash = useRef('');

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news-crawl', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const newHash = (data.items || []).map((i: CrawlItem) => i.id).join(',');
      if (newHash !== prevItemsHash.current) {
        prevItemsHash.current = newHash;
        setItems(data.items || []);
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNews]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;

    const speed = 0.8;

    const animate = () => {
      if (!isPaused) {
        scrollPos.current += speed;
        const halfWidth = el.scrollWidth / 2;
        if (halfWidth > 0 && scrollPos.current >= halfWidth) {
          scrollPos.current -= halfWidth;
        }
        el.style.transform = `translateX(-${scrollPos.current}px)`;
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [items, isPaused]);

  const togglePause = useCallback(() => {
    setIsPaused(p => !p);
  }, []);

  if (items.length === 0) return null;

  const doubled = [...items, ...items];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[60] bg-gradient-to-r from-[#0a0f18] via-[#0d1320] to-[#0a0f18] border-t border-cyan-500/20"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onClick={togglePause}
    >
      <div className="flex items-center h-8 sm:h-9 overflow-hidden">
        <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500 to-purple-500 px-2 sm:px-3 h-full flex items-center gap-1 sm:gap-1.5 z-10">
          <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-[11px] sm:text-[11px] font-bold text-white tracking-wider whitespace-nowrap">LIVE</span>
        </div>

        <div className="flex-1 overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-6 sm:w-8 bg-gradient-to-r from-[#0a0f18] to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-6 sm:w-8 bg-gradient-to-l from-[#0a0f18] to-transparent z-10 pointer-events-none" />

          <div ref={scrollRef} className="flex items-center whitespace-nowrap will-change-transform">
            {doubled.map((item, idx) => (
              <div key={`${item.id}-${idx}`} className="flex items-center flex-shrink-0 mx-3 sm:mx-4">
                {item.type === 'injury' ? (
                  <span className="text-[11px] sm:text-[11px] font-semibold text-red-400 mr-1 sm:mr-1.5 uppercase">INJURY</span>
                ) : (
                  <span className="text-[11px] sm:text-[11px] font-semibold text-cyan-400 mr-1 sm:mr-1.5 uppercase">{item.source || 'NEWS'}</span>
                )}
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`text-[11px] sm:text-[12px] hover:underline ${item.type === 'injury' ? 'text-red-200' : 'text-white/80'}`}
                  >
                    {item.text}
                  </a>
                ) : (
                  <span className={`text-[11px] sm:text-[12px] ${item.type === 'injury' ? 'text-red-200' : 'text-white/80'}`}>
                    {item.text}
                  </span>
                )}
                {item.team && (
                  <span className="text-[11px] sm:text-[11px] text-white/30 ml-1 sm:ml-1.5">{item.team}</span>
                )}
                <span className="text-[11px] sm:text-[11px] text-white/20 ml-1 sm:ml-1.5">{timeAgo(item.timestamp)}</span>
                <span className="text-white/10 ml-3 sm:ml-4">|</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
