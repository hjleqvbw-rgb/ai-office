import { runAgent } from './geminiRunner'
import { SYSTEM_PROMPTS } from './agents/systemPrompts'

const COMPRESS_THRESHOLD = 1500 // characters

export async function maybeCompress(
  latestOutput: string,
  prevSummary: string
): Promise<string> {
  const combined = prevSummary ? `${prevSummary}\n\n${latestOutput}` : latestOutput
  if (combined.length < COMPRESS_THRESHOLD) {
    return combined
  }
  const compressed = await runAgent(SYSTEM_PROMPTS.scribe, combined)
  return compressed.trim()
}

export function buildAgentContext(task: string, summary: string): string {
  if (!summary) return `任務: ${task}`
  return `任務: ${task}\n\n前面的工作摘要:\n${summary}`
}
