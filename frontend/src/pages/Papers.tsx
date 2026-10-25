import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPapers, createSession } from '../api'
import Icon from '../components/Icon'
const SECTIONS: Record<string, string> = { listening: '听力', cloze: '选词填空', matching: '长篇阅读', reading1: '仔细阅读一', reading2: '仔细阅读二', writing: '写作', translation: '翻译' }
const STATUS: Record<string, string> = { not_started: '未开始', in_progress: '进行中', done: '已完成' }
const PAGE_SIZE = 12

export default function Papers() {
  const nav = useNavigate()
  const [papers, setPapers] = useState<any[] | null>(null)
  const [date, setDate] = useState(''), [section, setSection] = useState(''), [status, setStatus] = useState('')
  const [search, setSearch] = useState(''), [sort, setSort] = useState('newest'), [page, setPage] = useState(1)
  const [err, setErr] = useState(''), [busy, setBusy] = useState('')
  useEffect(() => { listPapers().then(d => setPapers(d.papers)).catch(e => setErr(e.message || String(e))) }, [])
  const dates = useMemo(() => [...new Set((papers || []).map(p => `${p.year}-${String(p.month).padStart(2, '0')}`))].sort().reverse(), [papers])
  const shown = useMemo(() => (papers || []).filter(p => {
    const text = `${p.paper_key} ${p.year}年${p.month}月 第${p.set_no}套`.toLowerCase()
    return (!date || p.paper_key.startsWith(`${date}-`)) && (!section || p.question_counts?.[section]?.n > 0) && (!status || p.status === status) && search.toLowerCase().trim().split(/\s+/).every(s => text.includes(s))
  }).sort((a, b) => (sort === 'newest' ? b.year - a.year || b.month - a.month : a.year - b.year || a.month - b.month) || a.set_no - b.set_no), [papers, date, section, status, search, sort])
  useEffect(() => setPage(1), [date, section, status, search, sort])
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE)), currentPage = Math.min(page, pageCount)
  const visible = shown.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const active = papers?.filter(p => p.status === 'in_progress').sort((a, b) =>
    String(b.active_updated_at || '').localeCompare(String(a.active_updated_at || '')) || (b.active_session_id || 0) - (a.active_session_id || 0)
  )[0]
  function reset() { setDate(''); setSection(''); setStatus(''); setSearch('') }
  async function start(p: any, restart = false) {
    if (busy) return
    setBusy(p.paper_key); setErr('')
    try { const r = await createSession(p.paper_key, restart); nav(`/practice/${r.session_id}`) }
    catch (e: any) { setErr(e.message || String(e)) }
    finally { setBusy('') }
  }
  if (!papers) return <div className="loading" role="status">{err ? <><p>试卷库加载失败：{err}</p><button onClick={() => window.location.reload()}>重新加载</button></> : '正在整理你的试卷库…'}</div>
  return <div className="library-page">
    <section className="library-hero"><div><div className="eyebrow"><span/> YOUR PERSONAL ENGLISH SPACE</div><h1>每一次专注，<span>都离目标更近。</span></h1><p>从一套真题开始，找到自己的学习节奏。</p></div><div className="hero-aside"><span className="hero-monogram">Aa<span>.</span></span><span className="hero-aside-label">PRACTICE MAKES PROGRESS</span></div></section>
    <section className="library-stats" aria-label="学习概览">
      <div><span className="stat-label">历年真题 <Icon name="book" size={16}/></span><strong>{papers.length}<small>套</small></strong><span className="stat-caption">{dates.length ? `${dates[dates.length - 1].replace('-', '.')} — ${dates[0].replace('-', '.')}` : '等待导入'}</span></div>
      <div><span className="stat-label">客观题目 <Icon name="grid" size={16}/></span><strong>{papers.reduce((n, p) => n + p.objective_total, 0).toLocaleString()}<small>道</small></strong><span className="stat-caption">听力 · 选词 · 匹配 · 阅读</span></div>
      <div><span className="stat-label">进行中 <Icon name="clock" size={16}/></span><strong>{papers.filter(p => p.status === 'in_progress').length}<small>套</small></strong><span className="stat-caption">随时继续，进度自动保存</span></div>
      <div><span className="stat-label">已完成试卷 <Icon name="check" size={16}/></span><strong>{papers.filter(p => p.last_submitted_at).length}<small>套</small></strong><span className="stat-caption">每一份积累都有迹可循</span></div>
    </section>
    <section className="papers-section">
      <div className="section-heading"><div><h2>历年试卷 <span className="count-badge">{papers.length}</span></h2><p>按自己的节奏，认真完成每一套。</p></div>{active && <button className="resume-button" disabled={!!busy} onClick={() => start(active)}>继续上次练习 <Icon name="arrow" size={16}/></button>}</div>
      {err && <div className="notice error" role="alert">{err}<button onClick={() => setErr('')} aria-label="关闭错误提示"><Icon name="close" size={16}/></button></div>}
      <div className="library-toolbar"><label className="search-field"><Icon name="search" size={18}/><input aria-label="搜索试卷" placeholder="搜索年份、月份或套次…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button onClick={() => setSearch('')} aria-label="清空搜索"><Icon name="close" size={14}/></button>}</label><div className="filter-selects"><select aria-label="考试日期" value={date} onChange={e => setDate(e.target.value)}><option value="">全部日期</option>{dates.map(d => <option key={d} value={d}>{d.replace('-', ' 年 ')} 月</option>)}</select><select aria-label="题型" value={section} onChange={e => setSection(e.target.value)}><option value="">全部题型</option>{Object.entries(SECTIONS).map(([s, cn]) => <option key={s} value={s}>{cn}</option>)}</select><select aria-label="练习状态" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(STATUS).map(([s, cn]) => <option key={s} value={s}>{cn}</option>)}</select></div></div>
      <div className="library-meta"><span>找到 <b>{shown.length}</b> 套试卷{(date || section || status || search) && <button className="text-button" onClick={reset}>重置筛选</button>}</span><label>排序 <select aria-label="试卷排序" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">最新优先</option><option value="oldest">最早优先</option></select></label></div>
      <div className="paper-table-wrap"><table className="list paper-table"><thead><tr><th>试卷名称</th><th>题型材料</th><th>客观题</th><th>听力音频</th><th>练习状态</th><th aria-label="操作"/></tr></thead><tbody>{visible.map(p => {
        const noKey = p.objective_total - p.objective_keyed
        return <tr key={p.paper_key}>
          <td><div className="paper-name"><span className="paper-icon"><Icon name="book" size={19}/></span><div><b>{p.year} 年 {String(p.month).padStart(2, '0')} 月</b><span className="paper-subtitle">第 {p.set_no} 套 <span>·</span> CET-6</span></div></div></td>
          <td><div className="material-tags">{Object.entries(SECTIONS).filter(([s]) => s !== 'reading2').map(([s, cn]) => { const count = p.question_counts?.[s]?.n; return <span key={s} className={!count ? 'missing-material' : ''} title={!count ? `${cn}材料缺失` : s === 'reading1' ? `仔细阅读：${p.question_counts?.reading1?.n || 0} + ${p.question_counts?.reading2?.n || 0} 题` : `${cn}：${count} 题`}>{s === 'reading1' ? '仔细阅读' : cn}{!count && <small>缺</small>}</span> })}</div></td>
          <td><span className="objective-count">{p.objective_total}<small> 题</small></span>{noKey > 0 && <div className="key-warning" title="缺少标准答案的题可练习，但不参与判分">{noKey} 题待核对</div>}</td>
          <td><span className={`audio-label${p.has_audio ? ' available' : ''}`}><Icon name="headphones" size={16}/>{p.has_audio ? '可播放' : '暂无音频'}</span></td>
          <td><span className={`paper-status ${p.status}`}><span/>{STATUS[p.status] || '未开始'}</span>{p.status === 'in_progress' && <div className="answer-progress">已答 {p.active_answered} 题</div>}</td>
          <td><div className="paper-actions"><button className={`paper-action${p.status === 'in_progress' ? ' primary' : ''}`} disabled={!!busy} onClick={() => start(p)}>{busy === p.paper_key ? '正在打开' : p.status === 'in_progress' ? '继续练习' : p.status === 'done' ? '再练一次' : '开始练习'}<Icon name="arrow" size={15}/></button>{p.active_session_id && <button className="restart-link" title="新建空白练习，保留之前的作答" disabled={!!busy} onClick={() => start(p, true)}>重新开始</button>}</div></td>
        </tr>
      })}</tbody></table>{!shown.length && <div className="empty-state"><Icon name="search" size={32}/><h3>没有找到符合条件的试卷</h3><p>换个关键词，或清除筛选条件后再试。</p><button onClick={reset}>清除筛选</button></div>}</div>
      <div className="pagination"><span>{shown.length ? `显示 ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, shown.length)} 套，共 ${shown.length} 套` : '暂无匹配试卷'}</span><div><button aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><Icon name="chevron" size={15} style={{transform:'rotate(180deg)'}}/></button>{Array.from({length:pageCount}, (_, i) => i + 1).map(n => <button key={n} aria-label={`第 ${n} 页`} aria-current={n === currentPage ? 'page' : undefined} className={n === currentPage ? 'active' : ''} onClick={() => setPage(n)}>{n}</button>)}<button aria-label="下一页" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><Icon name="chevron" size={15}/></button></div></div>
    </section>
    <div className="library-footnote"><Icon name="shield" size={16}/><span>练习进度自动保存在本机。写作与翻译可记录草稿、查看参考解析，由你自行评阅。</span></div>
  </div>
}
