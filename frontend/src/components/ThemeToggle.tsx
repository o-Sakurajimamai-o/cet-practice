import Icon from './Icon'
import { useTheme } from '../theme'

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'
  return <button className={`theme-toggle${compact ? ' icon-btn' : ''}`} onClick={toggle} aria-label={label} title={label} aria-pressed={theme === 'dark'}>
    <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17}/>{!compact && <span>{theme === 'dark' ? '日间模式' : '夜间模式'}</span>}
  </button>
}
