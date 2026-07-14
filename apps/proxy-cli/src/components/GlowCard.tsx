export function GlowCard({
  children,
  color,
  glow = true,
}: {
  children: React.ReactNode
  color: string
  glow?: boolean
}): JSX.Element {
  const colorWithAlpha = (alpha: number) => {
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    return color
  }

  return (
    <div className="relative rounded-xl overflow-hidden">
      {/* Glow animation layer (optional) */}
      {glow && (
        <div className="absolute inset-0 rounded-xl" style={{ padding: '1px' }}>
          <div className="absolute inset-0 overflow-hidden rounded-xl">
            <div
              className="absolute"
              style={{
                width: '300%',
                height: '300%',
                left: '-100%',
                top: '-100%',
                background: `conic-gradient(from 0deg,
                  transparent 0deg,
                  transparent 70deg,
                  ${colorWithAlpha(0)} 80deg,
                  ${colorWithAlpha(1)} 100deg,
                  ${colorWithAlpha(1)} 140deg,
                  ${colorWithAlpha(0)} 160deg,
                  transparent 170deg,
                  transparent 250deg,
                  ${colorWithAlpha(0)} 260deg,
                  ${colorWithAlpha(1)} 280deg,
                  ${colorWithAlpha(1)} 320deg,
                  ${colorWithAlpha(0)} 340deg,
                  transparent 350deg,
                  transparent 360deg
                )`,
                animation: 'glowRotate 6s linear infinite',
                transformOrigin: 'center center',
              }}
            />
          </div>
          {/* Inner background mask - ensures full coverage */}
          <div
            className="absolute inset-[1px] rounded-xl"
            style={{
              background: 'var(--color-bg-card)',
              minHeight: '100%',
              height: '100%',
            }}
          />
        </div>
      )}

      {/* Glassmorphism content layer */}
      <div
        className={`relative z-10 p-3 rounded-xl ${!glow ? 'glass' : ''}`}
        style={
          glow
            ? {
                background: 'var(--color-bg-card)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: `1px solid ${colorWithAlpha(0.25)}`,
              }
            : undefined
        }
      >
        {children}
      </div>

      {glow && (
        <style>{`
          @keyframes glowRotate {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      )}
    </div>
  )
}
