'use client'

function sourceHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

interface Props {
  name: string
  size?: number
  className?: string
}

export function SourceBubble({ name, size = 20, className = '' }: Props) {
  const hue = sourceHue(name)
  const initial = name.charAt(0).toUpperCase()
  return (
    <span
      className={`anc-bubble ${className}`}
      style={{
        width: size,
        height: size,
        background: `oklch(0.58 0.12 ${hue})`,
        fontSize: Math.floor(size * 0.45),
      }}
    >
      {initial}
    </span>
  )
}
