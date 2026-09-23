import Link from 'next/link'
import { Pin, Shield, Users } from 'lucide-react'
import type { LeagueChatPreview } from '@/components/league/types'

export default function ChatBar({
  chat,
}: {
  chat: LeagueChatPreview
}) {
  return (
    // Sits on top of BottomNav, which grows by the home indicator; move with it.
    <div className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-3">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-[#1C2539]/95 px-4 py-3 shadow-2xl backdrop-blur">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0F3D35] text-[#00D4AA]">
          <Shield className="h-4.5 w-4.5" />
        </div>
        <Link href={chat.href} className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[14px] font-semibold text-white">
            <span>Chat</span>
            <span className="text-[#00D4AA]">*</span>
          </div>
          <div className="truncate text-[12px] text-[#8B9DB8]">
            {chat.senderName ? `${chat.senderName} • ` : ''}
            {chat.preview}
          </div>
        </Link>
        <Link href="/feed" className="text-[#8B9DB8] transition hover:text-white">
          <Pin className="h-4.5 w-4.5" />
        </Link>
        <Link
          href="/messages"
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-[#0B0F1E]"
        >
          <Users className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}
