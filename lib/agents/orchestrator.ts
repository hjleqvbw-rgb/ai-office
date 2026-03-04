import { TaskState, SubTask, AgentId, AgentEvent } from '@/types'
import { runAgent, RateLimitError } from '../geminiRunner'
import { SYSTEM_PROMPTS } from './systemPrompts'
import { maybeCompress, buildAgentContext } from '../contextManager'
import { saveTaskState } from '../taskStateManager'
import { v4 as uuidv4 } from 'uuid'

// Global SSE emitters map: taskId -> emit function
const emitters = new Map<string, (event: AgentEvent) => void>()
// DM queues: taskId:agentId -> messages
const dmQueues = new Map<string, string[]>()

export function registerEmitter(taskId: string, emit: (event: AgentEvent) => void) {
  emitters.set(taskId, emit)
}

export function unregisterEmitter(taskId: string) {
  emitters.delete(taskId)
}

export function queueDM(taskId: string, agentId: AgentId, message: string) {
  const key = `${taskId}:${agentId}`
  const q = dmQueues.get(key) ?? []
  q.push(message)
  dmQueues.set(key, q)
}

function emit(taskId: string, event: Omit<AgentEvent, 'timestamp'>) {
  const fn = emitters.get(taskId)
  if (fn) fn({ ...event, timestamp: Date.now() })
}

async function runAgentWithRetry(
  agentId: AgentId,
  systemPrompt: string,
  context: string,
  taskId: string,
  onChunk: (text: string) => void,
  retries = 3
): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      return await runAgent(systemPrompt, context, onChunk)
    } catch (err) {
      if (err instanceof RateLimitError) {
        const waitMs = 60000 // 60 seconds
        emit(taskId, {
          type: 'paused',
          from: agentId,
          to: 'all',
          content: `⏸ API 限流，${Math.round(waitMs / 1000)} 秒後自動繼續...`,
          taskId,
        })
        await new Promise(r => setTimeout(r, waitMs))
        emit(taskId, {
          type: 'resumed',
          from: agentId,
          to: 'all',
          content: `▶ 恢復工作中...`,
          taskId,
        })
      } else {
        throw err
      }
    }
  }
  throw new Error('Max retries exceeded')
}

async function runSingleAgent(
  agentId: AgentId,
  task: string,
  summary: string,
  taskId: string,
  agentName: string
): Promise<string> {
  const systemPrompt = SYSTEM_PROMPTS[agentId as keyof typeof SYSTEM_PROMPTS]
  const context = buildAgentContext(task, summary)

  emit(taskId, {
    type: 'status',
    from: agentId,
    to: 'all',
    content: `${agentName} 開始工作...`,
    taskId,
  })

  let fullOutput = ''
  const output = await runAgentWithRetry(
    agentId,
    systemPrompt,
    context,
    taskId,
    (chunk) => {
      fullOutput += chunk
    }
  )

  emit(taskId, {
    type: 'message',
    from: agentId,
    to: 'all',
    content: output,
    taskId,
  })

  return output
}

export async function startOrchestration(
  originalTask: string,
  agentNames: Record<AgentId, string>
): Promise<string> {
  const taskId = uuidv4()
  const state: TaskState = {
    taskId,
    originalTask,
    currentStepIndex: 0,
    plannedSteps: [],
    completedSteps: [],
    latestSummary: '',
    status: 'running',
    createdAt: Date.now(),
  }
  await saveTaskState(state)

  // Run orchestration in background (don't await)
  runOrchestration(state, agentNames).catch(console.error)

  return taskId
}

export async function runOrchestration(
  state: TaskState,
  agentNames: Record<AgentId, string>
) {
  const { taskId, originalTask } = state
  const managerName = agentNames['manager'] ?? 'Alex'

  try {
    // Step 1: Manager analyzes task
    emit(taskId, {
      type: 'status',
      from: 'manager',
      to: 'all',
      content: `${managerName} 正在分析任務...`,
      taskId,
    })

    const managerOutput = await runAgentWithRetry(
      'manager',
      SYSTEM_PROMPTS.manager,
      originalTask,
      taskId,
      () => {}
    )

    let subTasks: SubTask[] = []
    try {
      const parsed = JSON.parse(managerOutput.trim())
      subTasks = parsed.tasks ?? []
    } catch {
      // Try to extract JSON from the output
      const match = managerOutput.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          subTasks = JSON.parse(match[0]).tasks ?? []
        } catch {
          subTasks = [
            { agent: 'designer' as AgentId, task: originalTask, priority: 1 },
            { agent: 'coder' as AgentId, task: originalTask, priority: 2 },
            { agent: 'qa' as AgentId, task: originalTask, priority: 3 },
          ]
        }
      }
    }

    emit(taskId, {
      type: 'task_assign',
      from: 'manager',
      to: 'all',
      content: `已分析完成，分派 ${subTasks.length} 個子任務：\n${subTasks.map((t, i) => `${i + 1}. ${agentNames[t.agent] ?? t.agent}: ${t.task}`).join('\n')}`,
      taskId,
    })

    state.plannedSteps = subTasks
    state.latestSummary = await maybeCompress(managerOutput, '')
    await saveTaskState(state)

    // Execute each sub-task sequentially
    for (let i = state.currentStepIndex; i < subTasks.length; i++) {
      const subTask = subTasks[i]
      state.currentStepIndex = i
      const agentName = agentNames[subTask.agent] ?? subTask.agent

      // Check for pending DMs for this agent
      const dmKey = `${taskId}:${subTask.agent}`
      const pendingDMs = dmQueues.get(dmKey) ?? []
      if (pendingDMs.length > 0) {
        const dmMsg = pendingDMs.shift()!
        dmQueues.set(dmKey, pendingDMs)
        emit(taskId, {
          type: 'dm_reply',
          from: 'user',
          to: subTask.agent,
          content: `[私訊] ${dmMsg}`,
          taskId,
        })
        state.latestSummary = await maybeCompress(`用戶私訊給 ${agentName}: ${dmMsg}`, state.latestSummary)
      }

      const agentOutput = await runSingleAgent(
        subTask.agent,
        subTask.task,
        state.latestSummary,
        taskId,
        agentName
      )

      state.completedSteps.push({
        agentId: subTask.agent,
        task: subTask.task,
        output: agentOutput,
        completedAt: Date.now(),
      })

      // Compress context after each agent
      state.latestSummary = await maybeCompress(agentOutput, state.latestSummary)
      await saveTaskState(state)
    }

    // Final UX test if not already in steps
    const hasUxTest = subTasks.some(t => t.agent === 'uxTester')
    if (!hasUxTest) {
      const umaName = agentNames['uxTester'] ?? 'Uma'
      const uxOutput = await runSingleAgent(
        'uxTester',
        originalTask,
        state.latestSummary,
        taskId,
        umaName
      )
      state.completedSteps.push({
        agentId: 'uxTester',
        task: originalTask,
        output: uxOutput,
        completedAt: Date.now(),
      })
      state.latestSummary = await maybeCompress(uxOutput, state.latestSummary)
    }

    // Final summary
    const finalSummary = await runAgent(
      SYSTEM_PROMPTS.scribe,
      `完整任務記錄:\n${state.completedSteps.map(s => `[${s.agentId}] ${s.output}`).join('\n\n')}`
    )

    state.status = 'completed'
    state.latestSummary = finalSummary
    await saveTaskState(state)

    emit(taskId, {
      type: 'complete',
      from: 'scribe',
      to: 'all',
      content: finalSummary,
      taskId,
    })

    emit(taskId, {
      type: 'message',
      from: 'manager',
      to: 'user',
      content: `✅ 任務完成！${agentNames['manager'] ?? 'Alex'} 報告：\n${state.latestSummary}`,
      taskId,
    })

  } catch (error) {
    state.status = 'error'
    await saveTaskState(state)
    emit(taskId, {
      type: 'error',
      from: 'manager',
      to: 'all',
      content: `❌ 發生錯誤: ${error instanceof Error ? error.message : String(error)}`,
      taskId,
    })
  }
}
