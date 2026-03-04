import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Office — 虛擬 AI 辦公室',
  description: '多 Agent 協作的虛擬 AI 辦公室',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-TW">
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  )
}
