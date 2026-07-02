import { useInView } from 'react-intersection-observer'

export interface UseInViewControlOptions {
  threshold?: number
  rootMargin?: string
}

export function useInViewControl(options?: UseInViewControlOptions) {
  const { ref, inView } = useInView({
    threshold: options?.threshold ?? 0, // 降低threshold到0，任何可见即可
    rootMargin: options?.rootMargin ?? '200px', // 扩大rootMargin提前检测
    triggerOnce: false,
    initialInView: true, // 初始假设在视口内（展开后立即显示）
  })

  return { ref, inView }
}
