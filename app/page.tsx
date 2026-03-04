'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { AgentId, AgentState, AgentEvent, TaskState, AgentStep } from '@/types'
import { AGENT_CONFIGS, getAgentNames, saveAgentNames } from '@/constants/agentConfig'
import PublicChannel from '@/components/Chat/PublicChannel'
import DMPanel from '@/components/Chat/DMPanel'
import TaskPanel from '@/components/TaskPanel'

const OfficeCanvas = dynamic(() => import('@/components/Office/OfficeCanvas'), { ssr: false })

type AgentStates = Record<AgentId, AgentState>

const DEFAULT_STATES: AgentStates = {
  manager: 'idle', coder: 'idle', qa: 'idle',
  designer: 'idle', scribe: 'idle', uxTester: 'idle',
}

interface SpeechBubble {
  agentId: AgentId
  text: string
  expiresAt: number
}

export default function Home() {
  const [agentNames, setAgentNames] = useState<Record<AgentId, string>>({
    manager: 'Alex', coder: 'Dev', qa: 'Tester',
    designer: 'Aria', scribe: 'Memo', uxTester: 'Uma',
  })
  const [agentStates, setAgentStates] = useState<AgentStates>(DEFAULT_STATES)
  const [speechBubbles, setSpeechBubbles] = useState<SpeechBubble[]>([])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [taskState, setTaskState] = useState<TaskState | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [currentTaskId] = useState<string | null>(null)
  const [dmAgent, setDmAgent] = useState<AgentId | null>(null)
  const [latestSummary, setLatestSummary] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setAgentNames(getAgentNames())
  }, [])

  const setAgent = useCallback((id: AgentId, state: AgentState) => {
    setAgentStates(prev => ({ ...prev, [id]: state }))
  }, [])

  const addBubble = useCallback((agentId: AgentId, text: string) => {
    setSpeechBubbles(prev => [
      ...prev.filter(b => b.agentId !== agentId),
      { agentId, text: text.slice(0, 100), expiresAt: Date.now() + 5000 },
    ])
  }, [])

  const handleEvent = useCallback((event: AgentEvent) => {
    // Skip the completedSteps payload event (it's JSON, not display text)
    if (event.type === 'complete' && event.to === 'user' && event.content.startsWith('[')) {
      try {
        const steps: AgentStep[] = JSON.parse(event.content)
        setTaskState(prev => prev ? { ...prev, completedSteps: steps, status: 'completed' } : prev)
      } catch { /* ignore */ }
      return
    }

    setEvents(prev => [...prev, event])

    const id = event.from as AgentId
    const isAgent = AGENT_CONFIGS.some(a => a.id === id)
    if (!isAgent) return

    switch (event.type) {
      case 'status':
        setAgent(id, 'thinking')
        break
      case 'message':
        setAgent(id, 'talking')
        addBubble(id, event.content)
        setTimeout(() => setAgent(id, 'idle'), 4000)
        break
      case 'task_assign':
        setAgent('manager', 'talking')
        addBubble('manager', '任務分派中...')
        setTimeout(() => setAgent('manager', 'idle'), 3000)
        // Parse planned steps from content
        setTaskState(prev => {
          if (!prev) return prev
          const lines = event.content.split('\n').slice(1)
          const planned = lines.map((l, i) => {
            const match = l.match(/\d+\. (.+?): (.+)/)
            const agentName = match?.[1] ?? ''
            const task = match?.[2] ?? l
            const agentId = (AGENT_CONFIGS.find(a =>
              (prev ? agentNames[a.id] : a.defaultName) === agentName
            )?.id ?? 'coder') as AgentId
            return { agent: agentId, task, priority: i + 1 }
          })
          return { ...prev, plannedSteps: planned }
        })
        break
      case 'complete':
        setLatestSummary(event.content)
        AGENT_CONFIGS.forEach(a => setAgent(a.id, 'done'))
        setIsRunning(false)
        setTaskState(prev => prev ? { ...prev, status: 'completed', latestSummary: event.content } : prev)
        break
      case 'error':
        setAgent(id, 'idle')
        setIsRunning(false)
        break
      case 'paused':
        AGENT_CONFIGS.forEach(a => setAgent(a.id, 'resting'))
        break
      case 'resumed':
        AGENT_CONFIGS.forEach(a => setAgent(a.id, 'idle'))
        break
    }
  }, [addBubble, setAgent, agentNames])

  const startTask = useCallback(async (task: string) => {
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setEvents([])
    setIsRunning(true)
    setLatestSummary('')
    AGENT_CONFIGS.forEach(a => setAgent(a.id, 'idle'))

    const taskId = `task-${Date.now()}`
    setTaskState({
      taskId,
      originalTask: task,
      currentStepIndex: 0,
      plannedSteps: [],
      completedSteps: [],
      latestSummary: '',
      status: 'running',
      createdAt: Date.now(),
    })

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, agentNames }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        setIsRunning(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line || line === '') continue
          try {
            const event: AgentEvent = JSON.parse(line)
            handleEvent(event)
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setIsRunning(false)
      }
    } finally {
      setIsRunning(false)
    }
  }, [agentNames, handleEvent, setAgent])

  const handleNameChange = useCallback((agentId: AgentId, name: string) => {
    const updated = { ...agentNames, [agentId]: name }
    setAgentNames(updated)
    saveAgentNames(updated)
  }, [agentNames])

  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="border-b border-gray-800 px-4 py-2 flex items-center gap-3">
        <span className="text-xl">🏢</span>
        <h1 className="font-bold text-white">AI Office</h1>
        <span className="text-gray-600 text-xs">虛擬 AI 辦公室</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {isRunning && (
            <span className="text-blue-400 flex items-center gap-1">
              <span className="animate-pulse">●</span> 運行中
            </span>
          )}
          <span>點擊 Agent 可私訊</span>
        </div>
      </header>

      <div className="px-4 pt-3 pb-2">
        <OfficeCanvas
          agentStates={agentStates}
          speechBubbles={speechBubbles}
          agentNames={agentNames}
          onAgentClick={setDmAgent}
        />
      </div>

      <div className="flex-1 flex gap-3 px-4 pb-4 min-h-0" style={{ height: '380px' }}>
        <div className="flex-1 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <PublicChannel events={events} agentNames={agentNames} />
        </div>
        <div className="w-80 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <TaskPanel
            onSubmit={startTask}
            taskState={taskState}
            isRunning={isRunning}
            agentNames={agentNames}
          />
        </div>
      </div>

      {dmAgent && (
        <DMPanel
          agentId={dmAgent}
          agentName={agentNames[dmAgent]}
          taskId={currentTaskId}
          latestSummary={latestSummary}
          agentNames={agentNames}
          onClose={() => setDmAgent(null)}
          onNameChange={handleNameChange}
        />
      )}
    </div>
  )
}
