import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import Papers from './pages/Papers'
import Practice from './pages/Practice'
import Review from './pages/Review'
import Report from './pages/Report'
import Backup from './pages/Backup'
import Icon from './components/Icon'

export default function App() {
  const { pathname } = useLocation()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121212' : '#476b57')
  }, [theme])
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try { localStorage.setItem('cet6-theme', next) } catch { /* The current theme still works when storage is unavailable. */ }
  }
  const practicing = pathname.startsWith('/practice/')
  const title = practicing ? '专注练习' : pathname === '/review' ? '复习空间' : pathname === '/report' ? '题库报告' : pathname === '/backup' ? '备份与恢复' : '试卷库'
  useEffect(() => { document.title = `${title} · 六级研习室`; window.scrollTo(0, 0) }, [pathname, title])
  return <div className={`app${practicing ? ' is-practicing' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={e => {
      e.preventDefault()
      const main = document.getElementById('main-content')
      main?.focus({ preventScroll: true })
      main?.scrollIntoView({ block: 'start' })
    }}>跳到主要内容</a>
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="六级研习室首页"><span className="brand-mark"><Icon name="book" size={24}/></span><span>六级研习室<small>CET-6 STUDIO</small></span></NavLink>
      <div className="nav-label">学习空间</div>
      <nav className="main-nav" aria-label="主导航">
        <NavLink to="/" end><Icon name="grid"/><span>试卷库</span><Icon name="chevron" size={14}/></NavLink>
        <NavLink to="/review"><Icon name="review"/><span>复习空间</span><Icon name="chevron" size={14}/></NavLink>
        <NavLink to="/report"><Icon name="chart"/><span>题库报告</span><Icon name="chevron" size={14}/></NavLink>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-quote"><span>日积跬步，终至千里。</span><small>A little progress, every day.</small></div><NavLink className="backup-link" to="/backup"><Icon name="backup" size={18}/><span>备份与恢复</span></NavLink><div className="local-status"><span className="status-dot"/>本地运行 · 数据存于此设备</div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">学习空间 <span>/</span> <b>{title}</b></div><div className="topbar-actions"><span className="topbar-note"><Icon name="shield" size={15}/> 离线也能安心学习</span><button className="theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'} aria-pressed={theme === 'dark'} title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16}/><span>{theme === 'dark' ? '日间模式' : '夜间模式'}</span></button></div></header>
      <main id="main-content" tabIndex={-1}><Routes><Route path="/" element={<Papers/>}/><Route path="/practice/:sid" element={<Practice key={pathname}/>}/><Route path="/review" element={<Review/>}/><Route path="/report" element={<Report/>}/><Route path="/backup" element={<Backup/>}/><Route path="*" element={<div className="empty-state"><Icon name="book" size={36}/><h2>这个页面暂时找不到</h2><NavLink to="/" className="button primary">返回试卷库</NavLink></div>}/></Routes></main>
      <footer className="workspace-footer"><span>六级研习室</span><span>保持专注，让进步自然发生。</span><span>CET-6 · PERSONAL STUDY SPACE</span></footer>
    </div>
  </div>
}
