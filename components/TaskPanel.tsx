'use client'
import { useState } from 'react'
import { TaskState, AgentId } from '@/types'

interface Props {
  onSubmit: (task: string) => void
  taskState: TaskState | null
  isRunning: boolean
  agentNames: Record<AgentId, string>
  hideHeader?: boolean
}

export default function TaskPanel({ onSubmit, taskState, isRunning, agentNames, hideHeader }: Props) {
  const [input, setInput] = useState('')
  const [showOutput, setShowOutput] = useState(false)

  const handleSubmit = () => {
    if (!input.trim() || isRunning) return
    onSubmit(input.trim())
    setInput('')
  }

  const completedCount = taskState?.completedSteps.length ?? 0
  const totalCount = (taskState?.plannedSteps.length ?? 0) + (completedCount > 0 ? 1 : 0) // +1 for UX test

  return (
    <div className="flex flex-col h-full">
      {!hideHeader && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
          <span className="text-yellow-400">📋</span>
          <span className="font-semibold text-white text-sm">任務看板</span>
          {isRunning && (
            <span className="ml-auto flex items-center gap-1 text-xs text-blue-400">
              <span className="animate-pulse">●</span> 運行中
            </span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Progress */}
        {taskState && (
          <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
            <div className="text-xs text-gray-400 truncate">
              任務: {taskState.originalTask}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-500 rounded-full h-1.5 transition-all duration-500"
                  style={{ width: `${totalCount > 0 ? (completedCount / Math.max(totalCount, 1)) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">{completedCount}/{totalCount}</span>
            </div>

            {/* Sub-tasks */}
            {taskState.plannedSteps.map((step, i) => {
              const done = i < taskState.completedSteps.length
              const active = i === taskState.currentStepIndex && isRunning
              const name = agentNames[step.agent] ?? step.agent
              return (
                <div key={i} className={`flex items-start gap-2 text-xs p-1.5 rounded ${
                  done ? 'text-green-400' : active ? 'text-blue-400 bg-blue-900/20' : 'text-gray-500'
                }`}>
                  <span>{done ? '✓' : active ? '⟳' : '○'}</span>
                  <span className="flex-1 truncate">[{name}] {step.task}</span>
                </div>
              )
            })}

            {/* Show output toggle */}
            {taskState.status === 'completed' && (
              <div className="space-y-1.5">
                <button
                  onClick={() => setShowOutput(!showOutput)}
                  className="w-full text-xs text-blue-400 hover:text-blue-300 py-1 border border-blue-800/50 rounded hover:border-blue-600/50 transition-colors"
                >
                  {showOutput ? '▲ 收起成果' : '▼ 查看成果'}
                </button>
                {taskState.projectDir && (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => fetch(`/api/open-dir?path=${encodeURIComponent(taskState.projectDir!)}`)}
                      className="flex-1 text-xs bg-blue-800/40 hover:bg-blue-700/40 text-blue-300 py-1 rounded border border-blue-800/50 transition-colors"
                    >
                      📂 Finder
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(taskState.projectDir!)}
                      className="flex-1 text-xs bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 py-1 rounded border border-gray-600/50 transition-colors"
                    >
                      📋 複製路徑
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Output panel */}
        {showOutput && taskState?.status === 'completed' && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 space-y-3">
            <div className="text-xs text-gray-400 font-semibold">📂 任務成果</div>
            {taskState.completedSteps.map((step, i) => {
              const name = agentNames[step.agentId] ?? step.agentId
              return (
                <div key={i} className="space-y-1">
                  <div className="text-xs text-blue-400 font-semibold">{name} 的輸出</div>
                  <div className="text-xs text-gray-300 bg-gray-800 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                    {step.output}
                  </div>
                </div>
              )
            })}

            {/* Path display */}
            {taskState.projectDir && (
              <div className="text-xs text-gray-500 break-all bg-gray-950 rounded p-1.5 font-mono">
                {taskState.projectDir}
              </div>
            )}

            {/* Download button */}
            <button
              onClick={() => {
                const content = taskState.completedSteps
                  .map(s => `## ${agentNames[s.agentId] ?? s.agentId}\n\n${s.output}`)
                  .join('\n\n---\n\n')
                const blob = new Blob([content], { type: 'text/markdown' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `ai-office-output-${taskState.taskId.slice(0, 8)}.md`
                a.click()
                URL.revokeObjectURL(url)
              }}
              className="w-full text-xs bg-green-800/40 hover:bg-green-700/40 text-green-400 py-1.5 rounded border border-green-800/50 transition-colors"
            >
              ⬇ 下載成果 (.md)
            </button>
          </div>
        )}

        {/* Latest summary */}
        {taskState?.latestSummary && (
          <div className="bg-gray-800/30 rounded-lg p-2">
            <div className="text-xs text-yellow-400 mb-1">📝 Memo 的摘要</div>
            <div className="text-xs text-gray-400 leading-relaxed">{taskState.latestSummary}</div>
          </div>
        )}
      </div>

      {/* Task input */}
      <div className="p-3 border-t border-gray-700">
        <div className="space-y-2">
          <textarea
            className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-lg outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600 resize-none"
            placeholder="輸入任務或跟 Alex 說話..."
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && e.metaKey) handleSubmit()
            }}
            disabled={isRunning}
          />
          <button
            onClick={handleSubmit}
            disabled={isRunning || !input.trim()}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isRunning ? (
              <><span className="animate-spin">⟳</span> 執行中...</>
            ) : (
              <><span>▶</span> 提交任務<span className="text-xs text-blue-300">(⌘+Enter)</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
