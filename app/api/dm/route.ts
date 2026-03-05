import { NextRequest, NextResponse } from 'next/server'
import { runAgent } from '@/lib/geminiRunner'
import { runClaudeAgent } from '@/lib/claudeRunner'
import { SYSTEM_PROMPTS } from '@/lib/agents/systemPrompts'
import { AgentId } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const { agentId, message, agentNames, summary } = await req.json() as {
      agentId: AgentId
      message: string
      agentNames: Record<AgentId, string>
      summary?: string
    }

    if (!agentId || !message?.trim()) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 })
    }

    const context = summary
      ? `任務上下文: ${summary}\n\n老闆的私訊: ${message}`
      : `老闆的私訊: ${message}`

    let response: string

    if (agentId === 'manager') {
      // Manager uses Gemini (fast, no tools needed for DM)
      response = await runAgent(SYSTEM_PROMPTS.manager, context)
    } else {
      // All other agents use Claude CLI (can access files, run code if needed)
      response = await runClaudeAgent(agentId, context)
    }

    return NextResponse.json({ response })
  } catch (error) {
    console.error('DM error:', error)
    return NextResponse.json({ error: 'DM 發送失敗' }, { status: 500 })
  }
}
