import { useEffect } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import Papers from './pages/Papers'
import Practice from './pages/Practice'
import Review from './pages/Review'
import Report from './pages/Report'
import Backup from './pages/Backup'
import Icon, { type IconName } from './components/Icon'
import ThemeToggle from './components/ThemeToggle'

const NAV: { to: string; label: string; short: string; icon: IconName }[] = [
  { to: '/', label: '试卷库', short: '试卷', icon: 'grid' },
  { to: '/review', label: '复习空间', short: '复习', icon: 'review' },
  { to: '/report', label: '题库报告', short: '报告', icon: 'chart' },
  { to: '/backup', label: '备份与恢复', short: '备份', icon: 'backup' },
]

export default function App() {
  const { pathname } = useLocation()
  const practicing = pathname.startsWith('/practice/')
  const title = practicing ? '专注练习' : pathname === '/review' ? '复习空间' : pathname === '/report' ? '题库报告' : pathname === '/backup' ? '备份与恢复' : '试卷库'
  useEffect(() => { document.title = `${title} · 四六级研习室`; window.scrollTo(0, 0) }, [pathname, title])
  return <div className={`app${practicing ? ' is-practicing' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={e => {
      e.preventDefault()
      const main = document.getElementById('main-content')
      main?.focus({ preventScroll: true })
      main?.scrollIntoView({ block: 'start' })
    }}>跳到主要内容</a>
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="四六级研习室首页">
        <span className="brand-mark" aria-hidden="true">研</span>
        <span className="brand-text">四六级研习室<small>CET-4 / CET-6 Studio</small></span>
      </NavLink>
      <nav className="main-nav" aria-label="主导航">
        {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'}>
          <Icon name={n.icon} size={19}/><span className="nav-label-full">{n.label}</span><span className="nav-label-short">{n.short}</span>
        </NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-quote"><Icon name="sparkle" size={16}/><div><span>日积跬步，终至千里。</span><small>A little progress, every day.</small></div></div>
        <ThemeToggle/>
        <div className="local-status"><span className="status-dot"/>本地运行 · 数据只存于此设备</div>
      </div>
      <div className="mobile-theme"><ThemeToggle compact/></div>
    </aside>
    <div className="workspace">
      <main id="main-content" tabIndex={-1}><Routes><Route path="/" element={<Papers/>}/><Route path="/practice/:sid" element={<Practice key={pathname}/>}/><Route path="/review" element={<Review/>}/><Route path="/report" element={<Report/>}/><Route path="/backup" element={<Backup/>}/><Route path="*" element={<div className="empty-state"><Icon name="book" size={36}/><h3>这个页面暂时找不到</h3><NavLink to="/" className="button primary">返回试卷库</NavLink></div>}/></Routes></main>
      {!practicing && <footer className="workspace-footer"><span>四六级研习室 · 本地离线练习</span><span>保持专注，让进步自然发生。</span></footer>}
    </div>
  </div>
}
