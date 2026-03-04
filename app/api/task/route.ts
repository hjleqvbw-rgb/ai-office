import { NextRequest, NextResponse } from 'next/server'
import { startOrchestration } from '@/lib/agents/orchestrator'
import { AgentId } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { task, agentNames } = body as {
      task: string
      agentNames: Record<AgentId, string>
    }

    if (!task?.trim()) {
      return NextResponse.json({ error: '請輸入任務內容' }, { status: 400 })
    }

    const taskId = await startOrchestration(task.trim(), agentNames)
    return NextResponse.json({ taskId })
  } catch (error) {
    console.error('Task error:', error)
    return NextResponse.json({ error: '啟動任務失敗' }, { status: 500 })
  }
}
