export type AgentId = 'manager' | 'coder' | 'qa' | 'designer' | 'scribe' | 'uxTester'
export type UserOrAgent = AgentId | 'user'
export type AgentState = 'idle' | 'thinking' | 'typing' | 'talking' | 'resting' | 'done'

export interface AgentEvent {
  type: 'message' | 'status' | 'task_assign' | 'complete' | 'error' | 'paused' | 'resumed' | 'dm_reply' | 'plan'
  from: UserOrAgent
  to: UserOrAgent | 'all'
  content: string
  taskId?: string
  timestamp: number
}

export interface SubTask {
  agent: AgentId
  task: string
  priority: number
}

export interface AgentStep {
  agentId: AgentId
  task: string
  output: string
  completedAt: number
}

export interface TaskState {
  taskId: string
  originalTask: string
  currentStepIndex: number
  plannedSteps: SubTask[]
  completedSteps: AgentStep[]
  latestSummary: string
  projectDir?: string
  pausedAt?: number
  resumeAt?: number
  status: 'running' | 'paused' | 'completed' | 'error'
  createdAt: number
}

export interface DMMessage {
  agentId: AgentId
  taskId: string
  message: string
}

export interface AgentConfig {
  id: AgentId
  defaultName: string
  role: string
  color: string
  accentColor: string
}
