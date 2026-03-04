import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function runAgent(
  systemPrompt: string,
  userMessage: string,
  onChunk?: (text: string) => void
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: systemPrompt,
  })

  try {
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
    if (err?.status === 429) {
      throw new RateLimitError('Gemini rate limit hit')
    }
    throw error
  }
}

export class RateLimitError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'RateLimitError'
  }
}
