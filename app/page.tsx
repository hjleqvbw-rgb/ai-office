'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { AgentId, AgentState, AgentEvent, TaskState } from '@/types'
import { AGENT_CONFIGS, getAgentNames, saveAgentNames } from '@/constants/agentConfig'
import PublicChannel from '@/components/Chat/PublicChannel'
import DMPanel from '@/components/Chat/DMPanel'
import TaskPanel from '@/components/TaskPanel'

// Dynamically import canvas to avoid SSR issues
const OfficeCanvas = dynamic(() => import('@/components/Office/OfficeCanvas'), { ssr: false })

type AgentStates = Record<AgentId, AgentState>

const DEFAULT_AGENT_STATES: AgentStates = {
  manager: 'idle',
  coder: 'idle',
  qa: 'idle',
  designer: 'idle',
  scribe: 'idle',
  uxTester: 'idle',
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
  const [agentStates, setAgentStates] = useState<AgentStates>(DEFAULT_AGENT_STATES)
  const [speechBubbles, setSpeechBubbles] = useState<SpeechBubble[]>([])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [taskState, setTaskState] = useState<TaskState | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [dmAgent, setDmAgent] = useState<AgentId | null>(null)
  const [latestSummary, setLatestSummary] = useState('')

  const sseRef = useRef<EventSource | null>(null)

  // Load saved agent names on mount
  useEffect(() => {
    const saved = getAgentNames()
    setAgentNames(saved)
  }, [])

  const addSpeechBubble = useCallback((agentId: AgentId, text: string) => {
    const shortText = text.length > 120 ? text.slice(0, 117) + '...' : text
    setSpeechBubbles(prev => [
      ...prev.filter(b => b.agentId !== agentId),
      { agentId, text: shortText, expiresAt: Date.now() + 5000 },
    ])
  }, [])

  const setAgentState = useCallback((agentId: AgentId, state: AgentState) => {
    setAgentStates(prev => ({ ...prev, [agentId]: state }))
  }, [])

  const handleEvent = useCallback((event: AgentEvent) => {
    setEvents(prev => [...prev, event])

    const agentId = event.from as AgentId
    if (!['manager','coder','qa','designer','scribe','uxTester'].includes(agentId)) return

    switch (event.type) {
      case 'status':
        setAgentState(agentId, 'thinking')
        break
      case 'message':
        setAgentState(agentId, 'talking')
        addSpeechBubble(agentId, event.content.slice(0, 100))
        setTimeout(() => setAgentState(agentId, 'idle'), 4000)
        break
      case 'task_assign':
        setAgentState('manager', 'talking')
        addSpeechBubble('manager', '任務分派中...')
        setTimeout(() => setAgentState('manager', 'idle'), 3000)
        break
      case 'complete':
        setLatestSummary(event.content)
        AGENT_CONFIGS.forEach(a => setAgentState(a.id, 'done'))
        setIsRunning(false)
        setTaskState(prev => prev ? { ...prev, status: 'completed', latestSummary: event.content } : prev)
        break
      case 'error':
        setAgentState(agentId, 'idle')
        setIsRunning(false)
        break
      case 'paused':
        AGENT_CONFIGS.forEach(a => setAgentState(a.id, 'resting'))
        break
      case 'resumed':
        AGENT_CONFIGS.forEach(a => setAgentState(a.id, 'idle'))
        break
    }

    // Update task state for progress tracking
    if (event.type === 'message' && agentId !== 'scribe') {
      setTaskState(prev => {
        if (!prev) return prev
        const stepIndex = prev.plannedSteps.findIndex(s => s.agent === agentId)
        if (stepIndex === -1) return prev
        const alreadyDone = prev.completedSteps.some(s => s.agentId === agentId && s.task === prev.plannedSteps[stepIndex]?.task)
        if (alreadyDone) return prev
        return {
          ...prev,
          currentStepIndex: stepIndex + 1,
          completedSteps: [...prev.completedSteps, {
            agentId,
            task: prev.plannedSteps[stepIndex]?.task ?? '',
            output: event.content,
            completedAt: Date.now(),
          }],
        }
      })
    }
  }, [addSpeechBubble, setAgentState])

  const startTask = useCallback(async (task: string) => {
    // Close existing SSE
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }

    setEvents([])
    setIsRunning(true)
    setLatestSummary('')
    AGENT_CONFIGS.forEach(a => setAgentState(a.id, 'idle'))

    try {
      const res = await fetch('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, agentNames }),
      })
      const { taskId, error } = await res.json()

      if (error || !taskId) {
        setIsRunning(false)
        return
      }

      setCurrentTaskId(taskId)
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

      // Connect SSE
      const sse = new EventSource(`/api/stream/${taskId}`)
      sseRef.current = sse

      sse.onmessage = (e) => {
        try {
          const event: AgentEvent = JSON.parse(e.data)
          handleEvent(event)
        } catch {}
      }

      sse.onerror = () => {
        sse.close()
        setIsRunning(false)
      }
    } catch {
      setIsRunning(false)
    }
  }, [agentNames, handleEvent, setAgentState])

  const handleNameChange = useCallback((agentId: AgentId, name: string) => {
    const updated = { ...agentNames, [agentId]: name }
    setAgentNames(updated)
    saveAgentNames(updated)
  }, [agentNames])

  // Cleanup on unmount
  useEffect(() => {
    return () => { sseRef.current?.close() }
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-2 flex items-center gap-3">
        <span className="text-xl">🏢</span>
        <h1 className="font-bold text-white">AI Office</h1>
        <span className="text-gray-600 text-xs">虛擬 AI 辦公室</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {isRunning && <span className="text-blue-400 flex items-center gap-1"><span className="animate-pulse">●</span> 運行中</span>}
          <span>點擊 Agent 可私訊</span>
        </div>
      </header>

      {/* Canvas */}
      <div className="px-4 pt-3 pb-2">
        <OfficeCanvas
          agentStates={agentStates}
          speechBubbles={speechBubbles}
          agentNames={agentNames}
          onAgentClick={(agentId) => setDmAgent(agentId)}
        />
      </div>

      {/* Bottom panels */}
      <div className="flex-1 flex gap-3 px-4 pb-4 min-h-0" style={{ height: '380px' }}>
        {/* Public channel */}
        <div className="flex-1 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <PublicChannel events={events} agentNames={agentNames} />
        </div>

        {/* Task panel */}
        <div className="w-80 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <TaskPanel
            onSubmit={startTask}
            taskState={taskState}
            isRunning={isRunning}
            agentNames={agentNames}
          />
        </div>
      </div>

      {/* DM Panel */}
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
