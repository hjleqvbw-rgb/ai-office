import { NextRequest, NextResponse } from 'next/server'
import { queueDM } from '@/lib/agents/orchestrator'
import { runAgent } from '@/lib/geminiRunner'
import { SYSTEM_PROMPTS } from '@/lib/agents/systemPrompts'
import { AgentId } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { taskId, agentId, message, agentNames, summary } = body as {
      taskId: string
      agentId: AgentId
      message: string
      agentNames: Record<AgentId, string>
      summary?: string
    }

    if (!taskId || !agentId || !message?.trim()) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 })
    }

    // Queue the DM for the orchestrator
    queueDM(taskId, agentId, message)

    // Also get an immediate response from the agent
    const systemPrompt = SYSTEM_PROMPTS[agentId as keyof typeof SYSTEM_PROMPTS]
    const context = summary
      ? `任務上下文: ${summary}\n\n老闆的私訊: ${message}`
      : `老闆的私訊: ${message}`

    const response = await runAgent(systemPrompt, context)
    return NextResponse.json({ response })
  } catch (error) {
    console.error('DM error:', error)
    return NextResponse.json({ error: 'DM 發送失敗' }, { status: 500 })
  }
}
