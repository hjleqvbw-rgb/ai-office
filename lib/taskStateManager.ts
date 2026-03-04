import { TaskState } from '@/types'
import fs from 'fs/promises'
import path from 'path'

const TASKS_DIR = path.join(process.cwd(), 'tasks')

async function ensureDir() {
  await fs.mkdir(TASKS_DIR, { recursive: true })
}

export async function saveTaskState(state: TaskState): Promise<void> {
  await ensureDir()
  await fs.writeFile(
    path.join(TASKS_DIR, `${state.taskId}.json`),
    JSON.stringify(state, null, 2)
  )
}

export async function loadTaskState(taskId: string): Promise<TaskState | null> {
  try {
    const data = await fs.readFile(path.join(TASKS_DIR, `${taskId}.json`), 'utf-8')
    return JSON.parse(data) as TaskState
  } catch {
    return null
  }
}

export async function listPendingTasks(): Promise<TaskState[]> {
  await ensureDir()
  const files = await fs.readdir(TASKS_DIR)
  const states: TaskState[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const data = await fs.readFile(path.join(TASKS_DIR, file), 'utf-8')
      const state = JSON.parse(data) as TaskState
      if (state.status === 'paused') states.push(state)
    } catch {}
  }
  return states
}
