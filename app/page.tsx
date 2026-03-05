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
  const [clearing, setClearing] = useState(false)
  const [showTaskPanel, setShowTaskPanel] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const clearChannel = useCallback(async () => {
    if (clearing || isRunning || events.length === 0) return
    setClearing(true)
    try {
      // Ask Scribe to summarize before clearing
      const conversation = events
        .filter(e => e.type === 'message' || e.type === 'task_assign' || e.type === 'complete')
        .map(e => `[${agentNames[e.from as AgentId] ?? e.from}] ${e.content}`)
        .join('\n\n')

      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 'archive',
          agentId: 'scribe',
          message: `請為以下對話做一份完整摘要，保留所有重要資訊、決策、程式碼片段：\n\n${conversation}`,
          agentNames,
          summary: latestSummary,
        }),
      })
      const { response } = await res.json()

      // Save to localStorage with timestamp
      const key = 'ai-office-archives'
      const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
      existing.unshift({
        id: Date.now(),
        savedAt: new Date().toLocaleString('zh-TW'),
        summary: response ?? '（無摘要）',
        messageCount: events.length,
      })
      localStorage.setItem(key, JSON.stringify(existing.slice(0, 20))) // keep last 20

      setEvents([])
      setTaskState(null)
      setLatestSummary('')
    } finally {
      setClearing(false)
    }
  }, [clearing, isRunning, events, agentNames, latestSummary])

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
    if (event.type === 'complete' && event.to === 'user' &&
        (event.content.startsWith('[') || event.content.startsWith('{'))) {
      try {
        if (event.content.startsWith('[')) {
          const steps: AgentStep[] = JSON.parse(event.content)
          setTaskState(prev => prev ? { ...prev, completedSteps: steps, status: 'completed' } : prev)
        } else {
          const { steps, projectDir } = JSON.parse(event.content) as { steps: AgentStep[], projectDir: string }
          setTaskState(prev => prev ? { ...prev, completedSteps: steps, status: 'completed', projectDir } : prev)
        }
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
    <div className="bg-gray-950 flex flex-col min-h-screen md:h-screen md:overflow-hidden">
      <header className="border-b border-gray-800 px-4 py-2 flex items-center gap-3 shrink-0">
        <span className="text-xl">🏢</span>
        <h1 className="font-bold text-white">AI Office</h1>
        <span className="text-gray-600 text-xs hidden sm:inline">虛擬 AI 辦公室</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {isRunning && (
            <span className="text-blue-400 flex items-center gap-1">
              <span className="animate-pulse">●</span> 運行中
            </span>
          )}
          <span className="hidden sm:inline">點擊 Agent 可私訊</span>
        </div>
      </header>

      <div className="px-3 pt-2 pb-1 md:px-4 md:pt-3 md:pb-2 shrink-0">
        <OfficeCanvas
          agentStates={agentStates}
          speechBubbles={speechBubbles}
          agentNames={agentNames}
          onAgentClick={setDmAgent}
        />
      </div>

      {/* Desktop: side-by-side | Mobile: channel full width */}
      <div className="flex md:flex-1 gap-3 px-3 pb-3 md:px-4 md:pb-4 md:min-h-0 flex-1 min-h-0">
        {/* Public channel — full width on mobile, flex-1 on desktop */}
        <div className="flex-1 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden min-h-0">
          <PublicChannel
            events={events}
            agentNames={agentNames}
            onClear={clearChannel}
            clearing={clearing}
          />
        </div>

        {/* Desktop: always visible side panel */}
        <div className="hidden md:block md:w-80 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <TaskPanel
            onSubmit={startTask}
            taskState={taskState}
            isRunning={isRunning}
            agentNames={agentNames}
          />
        </div>
      </div>

      {/* Mobile: floating tab button (right edge) */}
      <button
        className="md:hidden fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-gray-800 border border-gray-700 border-r-0 rounded-l-xl py-5 px-1.5 flex flex-col items-center gap-1 shadow-lg"
        onClick={() => setShowTaskPanel(true)}
        aria-label="開啟任務看板"
      >
        <span className="text-base">📋</span>
        {isRunning && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
        {taskState && !isRunning && taskState.status === 'completed' && (
          <span className="w-2 h-2 rounded-full bg-green-400" />
        )}
      </button>

      {/* Mobile: task panel overlay */}
      {showTaskPanel && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowTaskPanel(false)}
        />
      )}
      <div className={`md:hidden fixed inset-y-0 right-0 z-50 w-[85vw] max-w-sm bg-gray-900 border-l border-gray-700 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${showTaskPanel ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Panel header with close */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
          <span className="text-white font-semibold text-sm">📋 任務看板</span>
          <button
            onClick={() => setShowTaskPanel(false)}
            className="text-gray-500 hover:text-white text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <TaskPanel
            onSubmit={(task) => { startTask(task); setShowTaskPanel(false) }}
            taskState={taskState}
            isRunning={isRunning}
            agentNames={agentNames}
            hideHeader
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
