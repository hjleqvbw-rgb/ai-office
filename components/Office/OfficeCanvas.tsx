'use client'
import { useEffect, useRef, useCallback } from 'react'
import { AgentId, AgentState } from '@/types'

interface AgentStates {
  manager: AgentState
  coder: AgentState
  qa: AgentState
  designer: AgentState
  scribe: AgentState
  uxTester: AgentState
}

interface SpeechBubble {
  agentId: AgentId
  text: string
  expiresAt: number
}

interface Props {
  agentStates: AgentStates
  speechBubbles: SpeechBubble[]
  agentNames: Record<AgentId, string>
  onAgentClick: (agentId: AgentId) => void
}

// Agent positions in canvas (x, y, width, height for click detection)
const AGENT_POSITIONS: Record<AgentId, { x: number; y: number; deskX: number; deskY: number }> = {
  manager:  { x: 100,  y: 160, deskX: 60,   deskY: 230 },
  coder:    { x: 285,  y: 170, deskX: 240,  deskY: 240 },
  qa:       { x: 470,  y: 165, deskX: 430,  deskY: 235 },
  designer: { x: 655,  y: 170, deskX: 610,  deskY: 240 },
  scribe:   { x: 840,  y: 165, deskX: 800,  deskY: 235 },
  uxTester: { x: 1025, y: 170, deskX: 985,  deskY: 240 },
}

const AGENT_SPRITE_COLORS: Record<AgentId, { skin: string; hair: string; shirt: string; pants: string; accessory: string }> = {
  manager:  { skin: '#FDBCB4', hair: '#2C1810', shirt: '#1E3A6E', pants: '#2C2C2C', accessory: '#C0B283' },
  coder:    { skin: '#F5C5A3', hair: '#1A1A2E', shirt: '#2D5A27', pants: '#1A1A2E', accessory: '#FF6B35' },
  qa:       { skin: '#DEB887', hair: '#8B4513', shirt: '#E85252', pants: '#2C2C2C', accessory: '#FFD700' },
  designer: { skin: '#FDBCB4', hair: '#4A0E8F', shirt: '#9B59B6', pants: '#2C2C2C', accessory: '#FF69B4' },
  scribe:   { skin: '#F0D9B5', hair: '#5C5C5C', shirt: '#8B7355', pants: '#4A4A4A', accessory: '#C0C0C0' },
  uxTester: { skin: '#C8A882', hair: '#2F4F4F', shirt: '#008B8B', pants: '#1C3A4A', accessory: '#00CED1' },
}

// Safe roundRect helper that falls back to regular rect
function safeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  try {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r)
    } else {
      ctx.rect(x, y, w, h)
    }
  } catch {
    ctx.rect(x, y, w, h)
  }
}

function drawPixelChar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  agentId: AgentId,
  state: AgentState,
  bobOffset: number,
  frameCount: number
) {
  const colors = AGENT_SPRITE_COLORS[agentId]
  const py = y + bobOffset
  const s = 3 // pixel scale

  ctx.save()

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.beginPath()
  ctx.ellipse(x + 12 * s, y + 32 * s + 2, 10 * s, 3 * s, 0, 0, Math.PI * 2)
  ctx.fill()

  // Body (shirt)
  ctx.fillStyle = colors.shirt
  ctx.fillRect(x + 7 * s, py + 13 * s, 10 * s, 12 * s)

  // Pants
  ctx.fillStyle = colors.pants
  ctx.fillRect(x + 7 * s,  py + 23 * s, 4 * s, 8 * s) // left leg
  ctx.fillRect(x + 13 * s, py + 23 * s, 4 * s, 8 * s) // right leg

  // Arms
  ctx.fillStyle = colors.shirt
  if (state === 'typing' && frameCount % 6 < 3) {
    // Typing: arms angled down
    ctx.fillRect(x + 3 * s, py + 14 * s, 4 * s, 6 * s)
    ctx.fillRect(x + 17 * s, py + 16 * s, 4 * s, 6 * s)
  } else {
    ctx.fillRect(x + 3 * s,  py + 13 * s, 4 * s, 8 * s)
    ctx.fillRect(x + 17 * s, py + 13 * s, 4 * s, 8 * s)
  }

  // Head
  ctx.fillStyle = colors.skin
  ctx.fillRect(x + 7 * s, py + 3 * s, 10 * s, 10 * s)

  // Hair
  ctx.fillStyle = colors.hair
  ctx.fillRect(x + 7 * s,  py + 1 * s, 10 * s, 4 * s)
  ctx.fillRect(x + 6 * s,  py + 3 * s,  2 * s, 3 * s)
  ctx.fillRect(x + 16 * s, py + 3 * s,  2 * s, 3 * s)

  // Eyes
  ctx.fillStyle = '#2C1810'
  ctx.fillRect(x + 9 * s,  py + 7 * s, 2 * s, 2 * s)
  ctx.fillRect(x + 13 * s, py + 7 * s, 2 * s, 2 * s)

  // Role-specific accessories
  drawAccessory(ctx, x, py, agentId, colors.accessory, s, state, frameCount)

  ctx.restore()
}

function drawAccessory(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  agentId: AgentId,
  color: string,
  s: number,
  state: AgentState,
  _frameCount: number
) {
  ctx.fillStyle = color
  switch (agentId) {
    case 'manager':
      // Tie
      ctx.fillRect(x + 11 * s, y + 14 * s, 2 * s, 8 * s)
      // Glasses
      ctx.strokeStyle = '#C0B283'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 8 * s,  y + 6 * s, 3 * s, 2 * s)
      ctx.strokeRect(x + 13 * s, y + 6 * s, 3 * s, 2 * s)
      break

    case 'coder':
      // Hood
      ctx.fillRect(x + 6 * s,  y + 1 * s, 12 * s, 3 * s)
      ctx.fillRect(x + 5 * s,  y + 3 * s,  2 * s, 4 * s)
      ctx.fillRect(x + 17 * s, y + 3 * s,  2 * s, 4 * s)
      break

    case 'qa':
      // Safety vest stripes
      ctx.fillStyle = '#FFD700'
      ctx.fillRect(x + 7 * s, y + 15 * s, 10 * s, 1 * s)
      ctx.fillRect(x + 7 * s, y + 19 * s, 10 * s, 1 * s)
      // Red pen in hand when active
      if (state === 'typing' || state === 'thinking') {
        ctx.fillStyle = '#E53935'
        ctx.fillRect(x + 18 * s, y + 14 * s, 1 * s, 6 * s)
      }
      break

    case 'designer':
      // Bun/ponytail
      ctx.fillStyle = '#4A0E8F'
      ctx.fillRect(x + 15 * s, y - 1 * s, 4 * s, 4 * s)
      // Earrings
      ctx.fillStyle = '#FF69B4'
      ctx.fillRect(x + 6 * s,  y + 8 * s, 1 * s, 2 * s)
      ctx.fillRect(x + 17 * s, y + 8 * s, 1 * s, 2 * s)
      break

    case 'scribe':
      // Thick-frame glasses
      ctx.strokeStyle = '#888'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 8 * s,  y + 6 * s, 3 * s, 2 * s)
      ctx.strokeRect(x + 13 * s, y + 6 * s, 3 * s, 2 * s)
      ctx.strokeStyle = '#888'
      ctx.beginPath()
      ctx.moveTo(x + 11 * s, y + 7 * s)
      ctx.lineTo(x + 13 * s, y + 7 * s)
      ctx.stroke()
      break

    case 'uxTester':
      // Headphones
      ctx.fillStyle = '#00CED1'
      ctx.fillRect(x + 5 * s,  y + 3 * s, 2 * s, 6 * s)
      ctx.fillRect(x + 17 * s, y + 3 * s, 2 * s, 6 * s)
      ctx.fillRect(x + 5 * s,  y + 2 * s, 14 * s, 2 * s)
      // Phone in hand
      ctx.fillStyle = '#333'
      ctx.fillRect(x + 18 * s, y + 17 * s, 3 * s, 5 * s)
      break
  }
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  agentId: AgentId,
  frameCount: number
) {
  // Desk surface
  ctx.fillStyle = '#6B4226'
  ctx.fillRect(x, y, 130, 12)
  // Desk legs
  ctx.fillStyle = '#4A2F1A'
  ctx.fillRect(x + 5,   y + 12, 10, 25)
  ctx.fillRect(x + 115, y + 12, 10, 25)
  // Desk front panel
  ctx.fillStyle = '#7D4E2D'
  ctx.fillRect(x + 10, y + 12, 110, 20)

  // Monitor body
  ctx.fillStyle = '#1A1A2E'
  ctx.fillRect(x + 35, y - 55, 65, 50)
  ctx.fillStyle = '#16213E'
  ctx.fillRect(x + 38, y - 52, 59, 44)
  // Monitor stand
  ctx.fillStyle = '#333'
  ctx.fillRect(x + 60, y - 5, 15, 5)
  ctx.fillRect(x + 55, y,     25, 3)

  // Screen content
  drawScreenContent(ctx, x + 38, y - 52, 59, 44, agentId, frameCount)
}

function drawScreenContent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  agentId: AgentId,
  frameCount: number
) {
  switch (agentId) {
    case 'manager': {
      // Task list / gantt chart style
      ctx.fillStyle = '#0D1B2A'
      ctx.fillRect(x, y, w, h)
      const barColors = ['#4A90D9', '#E67E22', '#27AE60', '#E74C3C']
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = barColors[i]
        ctx.fillRect(x + 4, y + 6 + i * 9, 20 + Math.sin(frameCount * 0.02 + i) * 5, 5)
      }
      break
    }
    case 'coder': {
      // Code editor with syntax highlighting
      ctx.fillStyle = '#1E1E2E'
      ctx.fillRect(x, y, w, h)
      const codeColors = ['#CDD6F4', '#89B4FA', '#A6E3A1', '#F38BA8']
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = codeColors[i % 4]
        const lineWidth = 10 + (i * 7) % 35
        ctx.fillRect(x + 2 + (i % 2) * 5, y + 4 + i * 7, lineWidth, 3)
      }
      // Cursor blink
      if (Math.floor(frameCount / 30) % 2 === 0) {
        ctx.fillStyle = '#CDD6F4'
        ctx.fillRect(x + 22, y + 32, 1, 5)
      }
      break
    }
    case 'qa': {
      // Red annotations / bug list
      ctx.fillStyle = '#1A0A0A'
      ctx.fillRect(x, y, w, h)
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i < 2 ? '#FF5252' : '#69F0AE'
        ctx.fillRect(x + 3, y + 5 + i * 9, 45, 4)
      }
      ctx.fillStyle = '#FF5252'
      ctx.font = '8px monospace'
      ctx.fillText('✗', x + 50, y + 12)
      ctx.fillText('✗', x + 50, y + 21)
      ctx.fillStyle = '#69F0AE'
      ctx.fillText('✓', x + 50, y + 30)
      break
    }
    case 'designer': {
      // Color palette + design mockup
      ctx.fillStyle = '#FAFAFA'
      ctx.fillRect(x, y, w, h)
      const palette = ['#E91E63', '#9C27B0', '#2196F3', '#4CAF50', '#FF9800']
      palette.forEach((c, i) => {
        ctx.fillStyle = c
        ctx.fillRect(x + 3 + i * 11, y + 3, 9, 9)
      })
      // Simple wireframe
      ctx.strokeStyle = '#BDBDBD'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 5, y + 16, 50, 25)
      ctx.fillStyle = '#E3F2FD'
      ctx.fillRect(x + 6, y + 17, 48, 8)
      break
    }
    case 'scribe': {
      // Document / notes
      ctx.fillStyle = '#FFFDE7'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#795548'
      for (let i = 0; i < 6; i++) {
        const lineW = 20 + (i * 13) % 30
        ctx.fillRect(x + 4, y + 4 + i * 7, lineW, 2)
      }
      break
    }
    case 'uxTester': {
      // Phone/tablet mockup
      ctx.fillStyle = '#1A1A2E'
      ctx.fillRect(x, y, w, h)
      // Phone frame
      ctx.fillStyle = '#333'
      ctx.fillRect(x + 15, y + 3, 28, 38)
      ctx.fillStyle = '#4FC3F7'
      ctx.fillRect(x + 17, y + 6, 24, 32)
      // App UI on phone
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(x + 18, y + 7, 22, 5)
      ctx.fillStyle = '#B3E5FC'
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + 18, y + 14 + i * 7, 22, 5)
      }
      break
    }
  }
}

function drawThinkingBubble(ctx: CanvasRenderingContext2D, x: number, y: number, frameCount: number) {
  const dots = [0, 1, 2]
  dots.forEach((i) => {
    const opacity = 0.3 + 0.7 * Math.abs(Math.sin(frameCount * 0.05 + i * 1.5))
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`
    ctx.beginPath()
    ctx.arc(x - 15 + i * 10, y - 10, 4, 0, Math.PI * 2)
    ctx.fill()
  })
  // Small bubbles leading to dots
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.beginPath(); ctx.arc(x - 18, y + 2, 3, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(x - 22, y + 8, 2, 0, Math.PI * 2); ctx.fill()
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  const maxWidth = 180
  const padding = 8
  const lineHeight = 14
  const fontSize = 11

  ctx.font = `${fontSize}px sans-serif`
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width > maxWidth - padding * 2) {
      if (current) lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)

  const maxLines = Math.min(lines.length, 3)
  const displayLines = lines.slice(0, maxLines)
  if (lines.length > 3) displayLines[2] = displayLines[2].slice(0, -3) + '...'

  const bw = maxWidth
  const bh = displayLines.length * lineHeight + padding * 2
  const bx = x - bw / 2
  const by = y - bh - 20

  // Bubble background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.strokeStyle = '#ccc'
  ctx.lineWidth = 1
  ctx.beginPath()
  safeRoundRect(ctx, bx, by, bw, bh, 8)
  ctx.fill()
  ctx.stroke()

  // Tail
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.beginPath()
  ctx.moveTo(x - 6, by + bh)
  ctx.lineTo(x + 6, by + bh)
  ctx.lineTo(x, by + bh + 10)
  ctx.closePath()
  ctx.fill()

  // Text
  ctx.fillStyle = '#333'
  ctx.font = `${fontSize}px sans-serif`
  displayLines.forEach((line, i) => {
    ctx.fillText(line, bx + padding, by + padding + (i + 1) * lineHeight - 3)
  })
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Back wall - dark brick
  ctx.fillStyle = '#2C1A0E'
  ctx.fillRect(0, 0, w, h * 0.55)

  // Brick pattern
  const brickW = 40
  const brickH = 14
  const wallH = h * 0.55
  for (let row = 0; row < Math.ceil(wallH / brickH); row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2
    for (let col = -1; col < Math.ceil(w / brickW) + 1; col++) {
      const bx = col * brickW + offset
      const by = row * brickH
      ctx.fillStyle = (row + col) % 3 === 0 ? '#3A2010' : '#2C1A0E'
      ctx.fillRect(bx + 1, by + 1, brickW - 2, brickH - 2)
      ctx.strokeStyle = '#1A0F07'
      ctx.lineWidth = 1
      ctx.strokeRect(bx + 1, by + 1, brickW - 2, brickH - 2)
    }
  }

  // Floor - warm wood
  const floorY = h * 0.55
  const floorGrad = ctx.createLinearGradient(0, floorY, 0, h)
  floorGrad.addColorStop(0,   '#8B6914')
  floorGrad.addColorStop(0.3, '#A07820')
  floorGrad.addColorStop(1,   '#6B5010')
  ctx.fillStyle = floorGrad
  ctx.fillRect(0, floorY, w, h - floorY)

  // Floor planks horizontal lines
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'
  ctx.lineWidth = 1
  for (let planky = floorY; planky < h; planky += 18) {
    ctx.beginPath()
    ctx.moveTo(0, planky)
    ctx.lineTo(w, planky)
    ctx.stroke()
  }
  // Floor planks vertical joints
  for (let plankx = 0; plankx < w; plankx += 120) {
    ctx.beginPath()
    ctx.moveTo(plankx, floorY)
    ctx.lineTo(plankx + 60, h)
    ctx.stroke()
  }

  // Ceiling lights
  const lightPositions = [200, 500, 800, 1100]
  lightPositions.forEach(lx => {
    // Cord
    ctx.fillStyle = '#5C3A1A'
    ctx.fillRect(lx - 2, 0, 4, 30)
    // Bulb
    ctx.fillStyle = '#FFF9C4'
    ctx.beginPath()
    ctx.arc(lx, 35, 12, 0, Math.PI * 2)
    ctx.fill()
    // Glow
    const glow = ctx.createRadialGradient(lx, 35, 0, lx, 35, 80)
    glow.addColorStop(0, 'rgba(255, 245, 180, 0.15)')
    glow.addColorStop(1, 'rgba(255, 245, 180, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(lx, 35, 80, 0, Math.PI * 2)
    ctx.fill()
  })

  // Office sign
  ctx.fillStyle = '#1A0F07'
  ctx.fillRect(w / 2 - 120, 10, 240, 55)
  ctx.strokeStyle = '#00FFFF'
  ctx.lineWidth = 2
  ctx.strokeRect(w / 2 - 118, 12, 236, 51)
  ctx.fillStyle = '#00FFFF'
  ctx.font = 'bold 22px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('AI OFFICE', w / 2, 42)
  ctx.fillStyle = '#88CCFF'
  ctx.font = '12px monospace'
  ctx.fillText('VIRTUAL TEAM', w / 2, 58)
  ctx.textAlign = 'left'

  // Corner plants
  const plantPositions = [20, w - 40]
  plantPositions.forEach(px => {
    // Pot
    ctx.fillStyle = '#8B4513'
    ctx.fillRect(px, h - 50, 25, 20)
    // Leaves
    ctx.fillStyle = '#2E7D32'
    ctx.beginPath()
    ctx.arc(px + 12, h - 55, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#388E3C'
    ctx.beginPath()
    ctx.arc(px + 5,  h - 60, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(px + 20, h - 62, 10, 0, Math.PI * 2)
    ctx.fill()
  })
}

export default function OfficeCanvas({ agentStates, speechBubbles, agentNames, onAgentClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef  = useRef(0)
  const animRef   = useRef<number | undefined>(undefined)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    frameRef.current++
    const frame = frameRef.current

    ctx.clearRect(0, 0, W, H)
    drawBackground(ctx, W, H)

    // Draw each agent
    const agentIds = Object.keys(AGENT_POSITIONS) as AgentId[]
    agentIds.forEach(agentId => {
      const pos   = AGENT_POSITIONS[agentId]
      const state = (agentStates[agentId] ?? 'idle') as AgentState

      // Draw desk first (behind character)
      drawDesk(ctx, pos.deskX, pos.deskY, agentId, frame)

      // Idle / resting bob animation
      const bobOffset =
        state === 'idle' || state === 'resting'
          ? Math.sin(frame * 0.03 + agentIds.indexOf(agentId)) * 2
          : 0

      // Draw character
      drawPixelChar(ctx, pos.x, pos.deskY - 80, agentId, state, bobOffset, frame)

      // Thinking bubble overlay
      if (state === 'thinking') {
        drawThinkingBubble(ctx, pos.x + 36, pos.deskY - 75, frame)
      }

      // Name tag
      const name = agentNames[agentId] ?? agentId
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.beginPath()
      safeRoundRect(ctx, pos.x - 5, pos.deskY + 8, 60, 16, 4)
      ctx.fill()
      ctx.fillStyle = '#FFF'
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(name, pos.x + 25, pos.deskY + 19)
      ctx.textAlign = 'left'

      // State indicator dot
      const dotColors: Record<AgentState, string> = {
        idle:     '#888',
        thinking: '#FFA726',
        typing:   '#42A5F5',
        talking:  '#66BB6A',
        resting:  '#78909C',
        done:     '#42A5F5',
      }
      ctx.fillStyle = dotColors[state] ?? '#888'
      ctx.beginPath()
      ctx.arc(pos.x + 53, pos.deskY + 15, 4, 0, Math.PI * 2)
      ctx.fill()
    })

    // Speech bubbles (drawn on top of everything)
    const now = Date.now()
    speechBubbles
      .filter(b => b.expiresAt > now)
      .forEach(b => {
        const pos = AGENT_POSITIONS[b.agentId]
        drawSpeechBubble(ctx, pos.x + 30, pos.deskY - 85, b.text)
      })

    animRef.current = requestAnimationFrame(draw)
  }, [agentStates, speechBubbles, agentNames])

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [draw])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * scaleX
    const cy = (e.clientY - rect.top)  * scaleY

    const agentIds = Object.keys(AGENT_POSITIONS) as AgentId[]
    for (const agentId of agentIds) {
      const pos = AGENT_POSITIONS[agentId]
      // Hit area covers character sprite + desk
      if (
        cx >= pos.x - 10 &&
        cx <= pos.x + 70 &&
        cy >= pos.deskY - 100 &&
        cy <= pos.deskY + 40
      ) {
        onAgentClick(agentId)
        return
      }
    }
  }, [onAgentClick])

  return (
    <canvas
      ref={canvasRef}
      width={1200}
      height={420}
      className="w-full cursor-pointer rounded-lg border border-gray-700"
      style={{ imageRendering: 'pixelated' }}
      onClick={handleClick}
    />
  )
}
