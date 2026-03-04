'use client'
import { useState, useRef, useEffect } from 'react'
import { AgentId } from '@/types'

const AGENT_EMOJI: Record<AgentId, string> = {
  manager: '👔',
  coder: '💻',
  qa: '🔍',
  designer: '🎨',
  scribe: '📝',
  uxTester: '📱',
}

const AGENT_ROLE: Record<AgentId, string> = {
  manager: '專案經理',
  coder: '工程師',
  qa: 'QA 測試員',
  designer: 'UI/UX 設計師',
  scribe: '文件管理員',
  uxTester: 'UX 體驗測試',
}

interface DMMessage {
  from: 'user' | AgentId
  content: string
  timestamp: number
}

interface Props {
  agentId: AgentId
  agentName: string
  taskId: string | null
  latestSummary: string
  agentNames: Record<AgentId, string>
  onClose: () => void
  onNameChange: (agentId: AgentId, name: string) => void
}

export default function DMPanel({
  agentId,
  agentName,
  taskId,
  latestSummary,
  agentNames,
  onClose,
  onNameChange,
}: Props) {
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(agentName)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const msg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { from: 'user', content: msg, timestamp: Date.now() }])
    setLoading(true)

    try {
      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: taskId ?? 'dm-standalone',
          agentId,
          message: msg,
          agentNames,
          summary: latestSummary,
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        from: agentId,
        content: data.response ?? data.error ?? '...',
        timestamp: Date.now(),
      }])
    } catch {
      setMessages(prev => [...prev, {
        from: agentId,
        content: '連線錯誤，請稍後再試。',
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
    }
  }

  const saveName = () => {
    if (nameInput.trim()) {
      onNameChange(agentId, nameInput.trim())
    }
    setEditingName(false)
  }

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col z-50" style={{ height: '420px' }}>
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-gray-700 bg-gray-800 rounded-t-xl">
        <span className="text-xl">{AGENT_EMOJI[agentId]}</span>
        <div className="flex-1">
          {editingName ? (
            <div className="flex items-center gap-1">
              <input
                className="bg-gray-700 text-white text-sm px-2 py-0.5 rounded w-28 outline-none border border-blue-500"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveName()}
                autoFocus
              />
              <button onClick={saveName} className="text-green-400 text-xs hover:text-green-300">✓</button>
              <button onClick={() => setEditingName(false)} className="text-gray-500 text-xs hover:text-gray-400">✕</button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="font-semibold text-white text-sm">{agentName}</span>
              <button
                onClick={() => { setNameInput(agentName); setEditingName(true) }}
                className="text-gray-500 hover:text-gray-300 text-xs"
                title="修改名字"
              >✏️</button>
            </div>
          )}
          <span className="text-gray-500 text-xs">{AGENT_ROLE[agentId]}</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {messages.length === 0 && (
          <div className="text-gray-600 text-center text-xs py-4">
            點擊私訊 {agentName}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap break-words ${
              msg.from === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-200 border border-gray-700'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400">
              {agentName} 思考中...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600"
            placeholder={`傳訊息給 ${agentName}...`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm transition-colors"
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  )
}
