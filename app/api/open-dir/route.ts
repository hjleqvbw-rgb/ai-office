import { exec } from 'child_process'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dirPath = searchParams.get('path')
  if (!dirPath) return Response.json({ error: 'no path' }, { status: 400 })
  exec(`open "${dirPath}"`)
  return Response.json({ ok: true })
}
