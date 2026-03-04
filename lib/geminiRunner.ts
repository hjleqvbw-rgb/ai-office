import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// Model rotation pool — ordered by preference
const MODEL_POOL = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
]

let modelIndex = 0

function nextModel(): string {
  const model = MODEL_POOL[modelIndex % MODEL_POOL.length]
  modelIndex++
  return model
}

export async function runAgent(
  systemPrompt: string,
  userMessage: string,
  onChunk?: (text: string) => void
): Promise<string> {
  // Try each model in the pool before giving up
  for (let attempt = 0; attempt < MODEL_POOL.length; attempt++) {
    const modelName = nextModel()
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
      })

      const result = await model.generateContentStream(userMessage)
      let output = ''
      for await (const chunk of result.stream) {
        const text = chunk.text()
        output += text
        if (onChunk) onChunk(text)
      }
      return output

    } catch (error: unknown) {
      const err = error as { status?: number; message?: string }

      // Rate limited on this model → try next one immediately
      if (err?.status === 429) {
        console.warn(`[gemini] ${modelName} rate limited, trying next model...`)
        continue
      }

      // Model not found → try next one
      if (err?.status === 404) {
        console.warn(`[gemini] ${modelName} not found, trying next model...`)
        continue
      }

      // Other error — rethrow
      throw error
    }
  }

  // All models exhausted — wait 60s then retry once with primary
  throw new RateLimitError('All models rate limited')
}

export class RateLimitError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'RateLimitError'
  }
}
