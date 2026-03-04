'use client'
import { useEffect, useRef } from 'react'
import { AgentEvent, AgentId } from '@/types'

interface Props {
  events: AgentEvent[]
  agentNames: Record<AgentId, string>
}

const AGENT_EMOJI: Record<string, string> = {
  manager: '👔',
  coder: '💻',
  qa: '🔍',
  designer: '🎨',
  scribe: '📝',
  uxTester: '📱',
  user: '👤',
}

const AGENT_COLORS: Record<string, string> = {
  manager: 'text-blue-400',
  coder: 'text-green-400',
  qa: 'text-red-400',
  designer: 'text-purple-400',
  scribe: 'text-yellow-400',
  uxTester: 'text-cyan-400',
  user: 'text-white',
}

const TYPE_LABELS: Record<string, string> = {
  task_assign: '📋 任務分派',
  complete: '✅ 完成',
  error: '❌ 錯誤',
  paused: '⏸ 暫停',
  resumed: '▶ 恢復',
  dm_reply: '💬 私訊',
  status: '',
  message: '',
}

export default function PublicChannel({ events, agentNames }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const getDisplayName = (agentId: string) => {
    if (agentId === 'user') return '你'
    return agentNames[agentId as AgentId] ?? agentId
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-green-400">●</span>
        <span className="font-semibold text-white text-sm">公共頻道</span>
        <span className="text-gray-500 text-xs ml-auto">{events.length} 則訊息</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {events.length === 0 && (
          <div className="text-gray-600 text-center py-8 text-xs">
            輸入任務後，辦公室就會開始運作...
          </div>
        )}

        {events.map((event, i) => {
          const isSystem = event.type === 'status'
          const typeLabel = TYPE_LABELS[event.type]
          const name = getDisplayName(event.from)
          const emoji = AGENT_EMOJI[event.from] ?? '🤖'
          const colorClass = AGENT_COLORS[event.from] ?? 'text-gray-300'

          if (isSystem && !event.content.includes('開始')) {
            return (
              <div key={i} className="text-gray-600 text-xs text-center py-1">
                {event.content}
              </div>
            )
          }

          return (
            <div key={i} className={`rounded-lg p-2 ${
              event.type === 'complete' ? 'bg-green-900/20 border border-green-800/30' :
              event.type === 'error' ? 'bg-red-900/20 border border-red-800/30' :
              event.type === 'task_assign' ? 'bg-blue-900/20 border border-blue-800/30' :
              event.type === 'paused' ? 'bg-yellow-900/20 border border-yellow-800/30' :
              'bg-gray-800/40'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <span>{emoji}</span>
                <span className={`font-semibold ${colorClass}`}>{name}</span>
                {event.to !== 'all' && event.to !== 'user' && (
                  <span className="text-gray-500 text-xs">→ {getDisplayName(event.to as string)}</span>
                )}
                {typeLabel && (
                  <span className="text-gray-500 text-xs ml-1">{typeLabel}</span>
                )}
                <span className="text-gray-600 text-xs ml-auto">{formatTime(event.timestamp)}</span>
              </div>
              <div className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {event.content}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
