import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ConversationQuerySchema = z.object({
  // The caller always passes strings (searchParams with a string fallback), so coercing
  // directly is the same contract; zod 4 rejects piping a string into z.coerce's `unknown` input.
  limit: z.coerce.number().int().positive().default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
})

const SaveConversationSchema = z.object({
  title: z.string().min(1).max(200),
  messageCount: z.number().int().nonnegative().default(0),
})

/**
 * GET /api/chimmy/conversations
 * List user's saved conversations (paginated, sorted by most recent)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const query = ConversationQuerySchema.parse({
      limit: searchParams.get('limit') ?? '20',
      offset: searchParams.get('offset') ?? '0',
    })

    const [conversations, total] = await Promise.all([
      prisma.chatConversation.findMany({
        where: { userId: session.user.id },
        select: { id: true, title: true, messageCount: true, lastMessageAt: true, dataSources: true, createdAt: true, updatedAt: true },
        orderBy: { lastMessageAt: 'desc' },
        skip: query.offset,
        take: query.limit,
      }),
      prisma.chatConversation.count({ where: { userId: session.user.id } }),
    ])

    return NextResponse.json({
      conversations,
      total,
      limit: query.limit,
      offset: query.offset,
    })
  } catch (err: unknown) {
    console.error('[GET /api/chimmy/conversations] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/chimmy/conversations
 * Create a new conversation (save current thread)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const payload = SaveConversationSchema.parse(body)

    const conversation = await prisma.chatConversation.create({
      data: {
        userId: session.user.id,
        title: payload.title,
        messageCount: payload.messageCount,
        lastMessageAt: new Date(),
      },
      select: { id: true, title: true, messageCount: true, lastMessageAt: true, createdAt: true },
    })

    return NextResponse.json(conversation, { status: 201 })
  } catch (err: unknown) {
    console.error('[POST /api/chimmy/conversations] error:', err)
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body', issues: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
