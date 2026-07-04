export function GlowCard({ children, color }: { children: React.ReactNode; color: string }): JSX.Element {
  // 将hex颜色转为带透明度的
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
    <div className="relative rounded-lg overflow-hidden">
      {/* 发光边框层 */}
      <div className="absolute inset-0 rounded-lg" style={{ padding: '1px' }}>
        <div className="absolute inset-0 overflow-hidden rounded-lg">
          {/* 大尺寸渐变背景，避免角落截断 */}
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
        {/* 内部背景遮罩 */}
        <div className="absolute inset-[1px] bg-bg-secondary rounded-lg" />
      </div>
      {/* 内容层 */}
      <div className="relative z-10 p-3">
        {children}
      </div>
      <style>{`
        @keyframes glowRotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
