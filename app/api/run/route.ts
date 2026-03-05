import { NextRequest } from 'next/server'
import { AgentId, AgentEvent, SubTask, AgentStep } from '@/types'
import { runAgent, RateLimitError } from '@/lib/geminiRunner'
import { SYSTEM_PROMPTS } from '@/lib/agents/systemPrompts'
import { maybeCompress, buildAgentContext } from '@/lib/contextManager'

export const maxDuration = 300 // 5 minutes for Vercel Pro / hobby

export async function POST(req: NextRequest) {
  const { task, agentNames } = await req.json() as {
    task: string
    agentNames: Record<AgentId, string>
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Omit<AgentEvent, 'timestamp'>) => {
        try {
          const data = `data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`
          controller.enqueue(encoder.encode(data))
        } catch { /* client disconnected */ }
      }

      const emitStatus = (from: AgentId, content: string) =>
        send({ type: 'status', from, to: 'all', content })

      const emitMsg = (from: AgentId, to: AgentId | 'all' | 'user', content: string) =>
        send({ type: 'message', from, to, content })

      async function callAgent(
        agentId: AgentId,
        context: string,
        retries = 3
      ): Promise<string> {
        const systemPrompt = SYSTEM_PROMPTS[agentId as keyof typeof SYSTEM_PROMPTS]
        for (let i = 0; i < retries; i++) {
          try {
            return await runAgent(systemPrompt, context)
          } catch (err) {
            if (err instanceof RateLimitError) {
              send({ type: 'paused', from: agentId, to: 'all', content: '⏸ API 限流，60 秒後自動繼續...' })
              await new Promise(r => setTimeout(r, 60000))
              send({ type: 'resumed', from: agentId, to: 'all', content: '▶ 恢復工作中...' })
            } else throw err
          }
        }
        throw new Error('Max retries exceeded')
      }

      try {
        const managerName = agentNames.manager ?? 'Alex'

        // 1. Manager 分析任務
        emitStatus('manager', `${managerName} 正在分析任務...`)
        const managerOut = await callAgent('manager', task)

        let subTasks: SubTask[] = []
        let parsedManager: {
          chat?: boolean; response?: string
          introduce?: boolean
          confirm?: boolean; question?: string
          tasks?: SubTask[]
        } = {}
        try {
          const json = managerOut.match(/\{[\s\S]*\}/)
          if (json) parsedManager = JSON.parse(json[0])
        } catch { /* fallback below */ }

        // 1a. 閒聊 — Alex 回一句話，結束
        if (parsedManager.chat === true) {
          emitMsg('manager', 'all', parsedManager.response ?? managerOut)
          send({ type: 'complete', from: 'scribe', to: 'all', content: '' })
          send({ type: 'complete', from: 'scribe', to: 'user', content: JSON.stringify([]) })
          return
        }

        // 1b. 自我介紹 — 每個 Agent 各說一下自己是誰
        if (parsedManager.introduce === true) {
          emitMsg('manager', 'all', `好！讓大家來自我介紹一下 👋`)
          const introAgents: AgentId[] = ['coder', 'qa', 'designer', 'scribe', 'uxTester']
          for (const agentId of introAgents) {
            const name = agentNames[agentId] ?? agentId
            emitStatus(agentId, `${name} 準備介紹自己...`)
            // 用 agent 本身的 system prompt + intro 指令，讓角色個性自然呈現
            const intro = await runAgent(
              SYSTEM_PROMPTS[agentId as keyof typeof SYSTEM_PROMPTS],
              SYSTEM_PROMPTS.intro
            )
            emitMsg(agentId, 'all', intro)
          }
          send({ type: 'complete', from: 'scribe', to: 'all', content: '' })
          send({ type: 'complete', from: 'scribe', to: 'user', content: JSON.stringify([]) })
          return
        }

        // 1c. 需要確認 — Alex 問用戶問題，等下一輪回覆
        if (parsedManager.confirm === true) {
          emitMsg('manager', 'all', parsedManager.question ?? '可以多說一點你想做什麼嗎？')
          send({ type: 'complete', from: 'scribe', to: 'all', content: '' })
          send({ type: 'complete', from: 'scribe', to: 'user', content: JSON.stringify([]) })
          return
        }

        subTasks = parsedManager.tasks ?? []
        if (!subTasks.length) {
          subTasks = [
            { agent: 'designer', task, priority: 1 },
            { agent: 'coder', task, priority: 2 },
            { agent: 'qa', task, priority: 3 },
          ]
        }

        send({
          type: 'task_assign',
          from: 'manager',
          to: 'all',
          content: `分析完成，分派 ${subTasks.length} 個子任務：\n${subTasks.map((t, i) =>
            `${i + 1}. ${agentNames[t.agent] ?? t.agent}: ${t.task}`).join('\n')}`,
        })

        let summary = await maybeCompress(managerOut, '')
        const completedSteps: AgentStep[] = []

        // 2. 執行每個子任務
        for (const subTask of subTasks) {
          const agentId = subTask.agent as AgentId
          const name = agentNames[agentId] ?? agentId
          emitStatus(agentId, `${name} 開始工作...`)

          const context = buildAgentContext(subTask.task, summary)
          const output = await callAgent(agentId, context)
          emitMsg(agentId, 'all', output)

          completedSteps.push({ agentId, task: subTask.task, output, completedAt: Date.now() })
          summary = await maybeCompress(output, summary)
        }

        // 3. UX Tester（如果還沒跑）
        if (!subTasks.some(t => t.agent === 'uxTester')) {
          const umaName = agentNames.uxTester ?? 'Uma'
          emitStatus('uxTester', `${umaName} 開始模擬用戶體驗...`)
          const uxOut = await callAgent('uxTester', buildAgentContext(task, summary))
          emitMsg('uxTester', 'all', uxOut)
          completedSteps.push({ agentId: 'uxTester', task, output: uxOut, completedAt: Date.now() })
          summary = await maybeCompress(uxOut, summary)
        }

        // 4. Scribe 最終摘要
        emitStatus('scribe', `${agentNames.scribe ?? 'Memo'} 整理最終摘要...`)
        const finalSummary = await callAgent(
          'scribe',
          completedSteps.map(s => `[${s.agentId}] ${s.output}`).join('\n\n')
        )

        send({ type: 'complete', from: 'scribe', to: 'all', content: finalSummary })
        emitMsg('manager', 'user',
          `✅ 任務完成！${managerName} 報告：\n${finalSummary}`)

        // 送出完整成果供前端顯示
        send({
          type: 'complete',
          from: 'scribe',
          to: 'user',
          content: JSON.stringify(completedSteps),
        })

      } catch (err) {
        send({
          type: 'error', from: 'manager', to: 'all',
          content: `❌ 錯誤: ${err instanceof Error ? err.message : String(err)}`,
        })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
