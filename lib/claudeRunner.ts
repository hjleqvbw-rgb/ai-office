import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

export const WORKSPACE = path.join(process.cwd(), 'workspace')

export function ensureAgentDir(agentId: string): string {
  const dir = path.join(WORKSPACE, agentId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export async function runClaudeAgent(
  agentId: string,
  task: string,
  onChunk?: (text: string) => void,
  workDir?: string  // optional: shared project dir (all agents work here)
): Promise<string> {
  const agentDir = ensureAgentDir(agentId)
  const cwd = workDir ?? agentDir

  // Prepend agent's personal CLAUDE.md as context (even when working in a different dir)
  const memoryPath = path.join(agentDir, 'CLAUDE.md')
  const memory = fs.existsSync(memoryPath)
    ? fs.readFileSync(memoryPath, 'utf-8').trim()
    : ''
  const fullTask = memory
    ? `以下是你的個人記憶和工作規範，請遵守：\n\n${memory}\n\n---\n\n${task}`
    : task

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '-p', fullTask,
      '--dangerously-skip-permissions',
    ], {
      cwd,
      env: process.env,
    })

    let output = ''

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      output += text
      onChunk?.(text)
    })

    proc.stderr.on('data', () => {
      // suppress stderr (tool execution logs) from public channel
    })

    proc.on('close', (code: number | null) => {
      if (output.length > 0) {
        resolve(output.trim())
      } else {
        reject(new Error(`Agent ${agentId} exited with code ${code} and no output`))
      }
    })

    proc.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn claude for ${agentId}: ${err.message}`))
    })
  })
}
