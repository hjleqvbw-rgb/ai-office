import { NextRequest } from 'next/server'
import { registerEmitter, unregisterEmitter } from '@/lib/agents/orchestrator'
import { AgentEvent } from '@/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const emit = (event: AgentEvent) => {
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        } catch {
          // Client disconnected
        }
      }

      registerEmitter(taskId, emit)

      // Send heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 15000)

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        unregisterEmitter(taskId)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
