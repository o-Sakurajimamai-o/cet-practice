import type { CSSProperties, ReactNode } from 'react'
export type IconName = 'book' | 'grid' | 'review' | 'chart' | 'backup' | 'arrow' | 'search' | 'headphones' | 'check' | 'clock' | 'chevron' | 'download' | 'upload' | 'shield' | 'close' | 'moon' | 'sun'
const paths: Record<IconName, ReactNode> = {
  moon: <path d="M20.9 13.2A9 9 0 0 1 10.8 3.1a9 9 0 1 0 10.1 10.1Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
  book: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/><path d="M12 6v14"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  review: <><path d="M3 10a9 9 0 1 1 1.6 7M3 4v6h6"/><path d="M12 7v5l3 2"/></>,
  chart: <path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>,
  backup: <path d="M6 8H4v13h16V8h-2M8 8l4-5 4 5m-4-5v12"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
}
export default function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>
}
