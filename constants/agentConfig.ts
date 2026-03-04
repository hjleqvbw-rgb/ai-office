import { AgentConfig, AgentId } from '@/types'

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'manager',
    defaultName: 'Alex',
    role: '專案經理',
    color: '#2D3A6B',
    accentColor: '#4A90D9',
  },
  {
    id: 'coder',
    defaultName: 'Dev',
    role: '工程師',
    color: '#1A3A2A',
    accentColor: '#4CAF50',
  },
  {
    id: 'qa',
    defaultName: 'Tester',
    role: 'QA 測試員',
    color: '#3A1A1A',
    accentColor: '#E53935',
  },
  {
    id: 'designer',
    defaultName: 'Aria',
    role: 'UI/UX 設計師',
    color: '#3A1A3A',
    accentColor: '#AB47BC',
  },
  {
    id: 'scribe',
    defaultName: 'Memo',
    role: '文件管理員',
    color: '#2A2A1A',
    accentColor: '#FFA726',
  },
  {
    id: 'uxTester',
    defaultName: 'Uma',
    role: 'UX 體驗測試',
    color: '#1A2A3A',
    accentColor: '#26C6DA',
  },
]

export const AGENT_NAMES_KEY = 'ai-office-agent-names'

export function getAgentNames(): Record<AgentId, string> {
  if (typeof window === 'undefined') {
    return Object.fromEntries(AGENT_CONFIGS.map(a => [a.id, a.defaultName])) as Record<AgentId, string>
  }
  const stored = localStorage.getItem(AGENT_NAMES_KEY)
  if (stored) {
    try { return JSON.parse(stored) } catch {}
  }
  return Object.fromEntries(AGENT_CONFIGS.map(a => [a.id, a.defaultName])) as Record<AgentId, string>
}

export function saveAgentNames(names: Record<AgentId, string>) {
  localStorage.setItem(AGENT_NAMES_KEY, JSON.stringify(names))
}
