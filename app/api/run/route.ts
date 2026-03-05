import { NextRequest } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { AgentId, AgentEvent, SubTask, AgentStep } from '@/types'
import { runAgent, RateLimitError } from '@/lib/geminiRunner'
import { runClaudeAgent, WORKSPACE } from '@/lib/claudeRunner'
import { SYSTEM_PROMPTS } from '@/lib/agents/systemPrompts'
import { maybeCompress, buildAgentContext } from '@/lib/contextManager'

export const maxDuration = 300

const execAsync = promisify(exec)
const CLAUDE_AGENTS: AgentId[] = ['coder', 'qa', 'designer', 'scribe', 'uxTester']

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

      // Manager uses Gemini (fast JSON intent detection)
      async function callManager(context: string, retries = 3): Promise<string> {
        for (let i = 0; i < retries; i++) {
          try {
            return await runAgent(SYSTEM_PROMPTS.manager, context)
          } catch (err) {
            if (err instanceof RateLimitError) {
              send({ type: 'paused', from: 'manager', to: 'all', content: '⏸ API 限流，60 秒後繼續...' })
              await new Promise(r => setTimeout(r, 60000))
              send({ type: 'resumed', from: 'manager', to: 'all', content: '▶ 恢復中...' })
            } else throw err
          }
        }
        throw new Error('Max retries exceeded')
      }

      try {
        const managerName = agentNames.manager ?? 'Alex'

        // 1. Manager 分析意圖
        emitStatus('manager', `${managerName} 正在分析任務...`)
        const managerOut = await callManager(task)

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
        } catch { /* fallback */ }

        // 閒聊
        if (parsedManager.chat === true) {
          emitMsg('manager', 'all', parsedManager.response ?? managerOut)
          send({ type: 'complete', from: 'scribe', to: 'all', content: '' })
          send({ type: 'complete', from: 'scribe', to: 'user', content: JSON.stringify([]) })
          return
        }

        // 自我介紹
        if (parsedManager.introduce === true) {
          emitMsg('manager', 'all', `好！讓大家來自我介紹一下 👋`)
          for (const agentId of CLAUDE_AGENTS) {
            const name = agentNames[agentId] ?? agentId
            emitStatus(agentId, `${name} 準備介紹自己...`)
            const intro = await runClaudeAgent(
              agentId,
              '請用 2-3 句話，用第一人稱友善地介紹你自己：你叫什麼名字、你負責什麼、你工作的風格。語氣輕鬆，像在跟新朋友打招呼。不要開始工作。'
            )
            emitMsg(agentId, 'all', intro)
          }
          send({ type: 'complete', from: 'scribe', to: 'all', content: '' })
          send({ type: 'complete', from: 'scribe', to: 'user', content: JSON.stringify([]) })
          return
        }

        // 需要確認
        if (parsedManager.confirm === true) {
          emitMsg('manager', 'all', parsedManager.question ?? '可以多說一點你想做什麼嗎？')
          send({ type: 'complete', from: 'scribe', to: 'all', content: '' })
          send({ type: 'complete', from: 'scribe', to: 'user', content: JSON.stringify([]) })
          return
        }

        // ── 正式任務 ──

        subTasks = parsedManager.tasks ?? []
        if (!subTasks.length) {
          subTasks = [
            { agent: 'designer', task, priority: 1 },
            { agent: 'coder', task, priority: 2 },
            { agent: 'qa', task, priority: 3 },
          ]
        }

        // 建立共用專案目錄（所有 Agent 都在這裡工作）
        const taskId = `task-${Date.now()}`
        const projectDir = path.join(WORKSPACE, 'projects', taskId)
        fs.mkdirSync(projectDir, { recursive: true })

        // 把全局規範複製進專案目錄的 CLAUDE.md
        const globalMemoryPath = path.join(WORKSPACE, 'CLAUDE.md')
        const globalMemory = fs.existsSync(globalMemoryPath)
          ? fs.readFileSync(globalMemoryPath, 'utf-8')
          : ''
        fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'),
          `${globalMemory}\n\n# 本次專案任務\n${task}\n\n# 開始時間\n${new Date().toLocaleString('zh-TW')}\n`
        )

        send({
          type: 'task_assign',
          from: 'manager',
          to: 'all',
          content: `分析完成，分派 ${subTasks.length} 個子任務：\n${subTasks.map((t, i) =>
            `${i + 1}. ${agentNames[t.agent as AgentId] ?? t.agent}: ${t.task}`).join('\n')}`,
        })

        let summary = await maybeCompress(managerOut, '')
        const completedSteps: AgentStep[] = []

        // 2. 執行每個子任務（共用 projectDir）
        for (const subTask of subTasks) {
          const agentId = subTask.agent as AgentId
          const name = agentNames[agentId] ?? agentId
          emitStatus(agentId, `${name} 開始工作...`)

          const context = buildAgentContext(subTask.task, summary)
          const output = await runClaudeAgent(agentId, context,
            (chunk) => { if (chunk.trim()) emitStatus(agentId, chunk) },
            projectDir
          )
          emitMsg(agentId, 'all', output)

          completedSteps.push({ agentId, task: subTask.task, output, completedAt: Date.now() })
          summary = await maybeCompress(output, summary)
        }

        // 3. UX Tester
        if (!subTasks.some(t => t.agent === 'uxTester')) {
          const umaName = agentNames.uxTester ?? 'Uma'
          emitStatus('uxTester', `${umaName} 開始模擬用戶體驗...`)
          const uxOut = await runClaudeAgent('uxTester',
            buildAgentContext(task, summary),
            (chunk) => { if (chunk.trim()) emitStatus('uxTester', chunk) },
            projectDir
          )
          emitMsg('uxTester', 'all', uxOut)
          completedSteps.push({ agentId: 'uxTester', task, output: uxOut, completedAt: Date.now() })
          summary = await maybeCompress(uxOut, summary)
        }

        // 4. Scribe 最終摘要 + 更新各 Agent 記憶
        const memoName = agentNames.scribe ?? 'Memo'
        emitStatus('scribe', `${memoName} 整理摘要並更新團隊記憶...`)

        const allOutputs = completedSteps.map(s => `[${s.agentId}] ${s.output}`).join('\n\n')
        const finalSummary = await runClaudeAgent('scribe',
          `請完成以下兩件事：

1. 把以下內容壓縮成 150 字以內的任務摘要（繁體中文，條列式）：
${allOutputs}

2. 把這次任務學到的重要規律，分別寫入各 Agent 的 CLAUDE.md（路徑：../[agentId]/CLAUDE.md，相對於你的工作目錄 ${path.join(WORKSPACE, 'scribe')}）。只加入有學習價值的內容，不重複。

先輸出摘要，再說明你更新了哪些記憶。`,
          (chunk) => { if (chunk.trim()) emitStatus('scribe', chunk) }
          // Scribe updates agent memories → use its own dir, not projectDir
        )

        send({ type: 'complete', from: 'scribe', to: 'all', content: finalSummary })
        emitMsg('manager', 'user', `✅ 任務完成！${managerName} 報告：\n${finalSummary}`)

        // 5. Git commit + 嘗試 push 到 GitHub
        try {
          await execAsync('git init && git add -A', { cwd: projectDir })
          await execAsync('git config user.email "ai-office@local" && git config user.name "AI Office"', { cwd: projectDir })
          const commitMsg = `feat: ${task.slice(0, 60).replace(/"/g, "'")}`
          await execAsync(`git commit -m "${commitMsg}"`, { cwd: projectDir })

          // 嘗試用 gh CLI 建立 repo 並 push
          try {
            await execAsync('gh --version')
            const repoName = task.slice(0, 40)
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '')
              .trim()
              .replace(/\s+/g, '-')
              .slice(0, 40)
            await execAsync(
              `gh repo create "${repoName}" --public --source=. --push`,
              { cwd: projectDir }
            )
            const { stdout: remoteUrl } = await execAsync(
              'git remote get-url origin',
              { cwd: projectDir }
            )
            emitMsg('manager', 'user',
              `📦 代碼已推送到 GitHub！\n${remoteUrl.trim()}\n\n下一步：去 Vercel 選這個 repo，點 Import 就完成部署了。`)
          } catch {
            // gh 不可用，告知用戶手動操作
            emitMsg('manager', 'user',
              `📁 代碼已 commit，存放在：\n${projectDir}\n\n下一步：\n1. 在 GitHub 建立新 repo\n2. git remote add origin [你的 repo URL]\n3. git push -u origin main\n4. 去 Vercel Import 那個 repo`)
          }
        } catch (gitErr) {
          emitMsg('manager', 'user', `📁 專案路徑：${projectDir}`)
        }

        send({ type: 'complete', from: 'scribe', to: 'user', content: JSON.stringify({ steps: completedSteps, projectDir }) })

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
