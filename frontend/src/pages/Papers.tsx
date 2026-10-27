import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPapers, createSession } from '../api'
import Icon from '../components/Icon'
const SECTIONS: Record<string, string> = { listening: '听力', cloze: '选词填空', matching: '长篇阅读', reading1: '仔细阅读一', reading2: '仔细阅读二', writing: '写作', translation: '翻译' }
const STATUS: Record<string, string> = { not_started: '未开始', in_progress: '进行中', done: '已完成' }
const EXAMS = [{ value: 'cet4', num: '4', name: '英语四级', code: 'CET-4' }, { value: 'cet6', num: '6', name: '英语六级', code: 'CET-6' }]

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}
const paperTitle = (p: any) => `${p.year} 年 ${p.month} 月 · 第 ${p.set_no} 套`

export default function Papers() {
  const nav = useNavigate()
  const [papers, setPapers] = useState<any[] | null>(null)
  const [papersExam, setPapersExam] = useState('')
  const [exam, setExam] = useState(() => localStorage.getItem('cet-exam') === 'cet4' ? 'cet4' : 'cet6')
  const [date, setDate] = useState(''), [section, setSection] = useState(''), [status, setStatus] = useState('')
  const [search, setSearch] = useState(''), [sort, setSort] = useState('newest')
  const [err, setErr] = useState(''), [busy, setBusy] = useState('')
  // The previous list stays visible (dimmed) while the other exam loads, so the switch never jumps away.
  useEffect(() => { let live = true; localStorage.setItem('cet-exam', exam); listPapers(new URLSearchParams({ exam })).then(d => { if (live) { setPapers(d.papers); setPapersExam(exam) } }).catch(e => { if (live) { setPapers(null); setErr(e.message || String(e)) } }); return () => { live = false } }, [exam])
  const switching = papersExam !== exam
  const dates = useMemo(() => [...new Set((papers || []).map(p => `${p.year}-${String(p.month).padStart(2, '0')}`))].sort().reverse(), [papers])
  const shown = useMemo(() => (papers || []).filter(p => {
    const text = `${p.paper_key} ${p.year}年${p.month}月 第${p.set_no}套`.toLowerCase()
    return (!date || `${p.year}-${String(p.month).padStart(2, '0')}` === date) && (!section || p.question_counts?.[section]?.n > 0) && (!status || p.status === status) && search.toLowerCase().trim().split(/\s+/).every(s => text.includes(s))
  }).sort((a, b) => (sort === 'newest' ? b.year - a.year || b.month - a.month : a.year - b.year || a.month - b.month) || a.set_no - b.set_no), [papers, date, section, status, search, sort])
  // One card per exam sitting; the sets of the same sitting stay together.
  const groups = useMemo(() => {
    const out: { key: string; year: number; month: number; papers: any[] }[] = []
    for (const p of shown) {
      const key = `${p.year}-${p.month}`
      const last = out[out.length - 1]
      if (last?.key === key) last.papers.push(p)
      else out.push({ key, year: p.year, month: p.month, papers: [p] })
    }
    return out
  }, [shown])
  const active = papers?.filter(p => p.status === 'in_progress').sort((a, b) =>
    String(b.active_updated_at || '').localeCompare(String(a.active_updated_at || '')) || (b.active_session_id || 0) - (a.active_session_id || 0)
  )[0]
  const suggested = active || papers?.slice().sort((a, b) => b.year - a.year || b.month - a.month || a.set_no - b.set_no).find(p => p.status === 'not_started')
  function reset() { setDate(''); setSection(''); setStatus(''); setSearch('') }
  async function start(p: any, restart = false) {
    if (busy || switching) return
    setBusy(p.paper_key); setErr('')
    try { const r = await createSession(p.paper_key, restart); nav(`/practice/${r.session_id}`) }
    catch (e: any) { setErr(e.message || String(e)) }
    finally { setBusy('') }
  }
  if (!papers) return <div className="loading" role="status">{err ? <><p>试卷库加载失败：{err}</p><button onClick={() => window.location.reload()}>重新加载</button></> : <><span className="spinner"/>正在整理你的试卷库…</>}</div>
  const objectiveTotal = papers.reduce((n, p) => n + p.objective_total, 0)
  const inProgress = papers.filter(p => p.status === 'in_progress').length
  const finished = papers.filter(p => p.last_submitted_at).length
  const statusCounts: Record<string, number> = { '': papers.length }
  for (const p of papers) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1
  const examName = exam === 'cet4' ? '英语四级' : '英语六级', examCode = exam === 'cet4' ? 'CET-4' : 'CET-6'
  return <div className={`library-page${switching ? ' switching' : ''}`} aria-busy={switching}>
    <section className={`hero ${exam}`}>
      <span className="hero-watermark" aria-hidden="true">{examCode}</span>
      <div className="hero-top">
        <div className="exam-switch" role="group" aria-label="选择考试">
          {EXAMS.map(e => <button key={e.value} className={exam === e.value ? 'active' : ''} aria-pressed={exam === e.value} onClick={() => { if (exam !== e.value) { reset(); setExam(e.value) } }}>
            <span className="exam-num" aria-hidden="true">{e.num}</span><span className="exam-label"><b>{e.name}</b><small>{e.code}</small></span>
          </button>)}
        </div>
        <span className="hero-kicker"><Icon name="sparkle" size={15}/>{greeting()} · {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
      </div>
      <div className="hero-main">
        <h1>每一次专注，<br/>都离目标更近一步。</h1>
        <p><b>{examName}</b> · {papers.length} 套历年真题、{objectiveTotal.toLocaleString()} 道客观题。点击作答、自动判分，进度随时保存在本机。</p>
      </div>
      {suggested && <div className="hero-card">
        <span className="hero-card-label">{active ? <><Icon name="clock" size={15}/>继续上次练习</> : <><Icon name="target" size={15}/>推荐从这里开始</>}</span>
        <b className="hero-card-title">{paperTitle(suggested)}</b>
        <span className="hero-card-meta">{examCode} · {suggested.objective_total} 道客观题 · {suggested.has_audio ? '含听力音频' : '无听力音频'}</span>
        {active && <div className="hero-progress" aria-label={`已答 ${active.active_answered} / ${active.objective_total} 题`}>
          <div className="progress-track"><span style={{ width: `${Math.min(100, (active.active_answered / Math.max(1, active.objective_total)) * 100)}%` }}/></div>
          <span>已答 {active.active_answered} / {active.objective_total}</span>
        </div>}
        <button className="hero-cta" disabled={!!busy || switching} onClick={() => start(suggested)}>{busy === suggested.paper_key ? '正在打开…' : active ? '继续练习' : '开始练习'}<Icon name="arrow" size={17}/></button>
      </div>}
    </section>

    <section className="stat-row" aria-label="学习概览">
      <div className="stat-tile"><span className="stat-icon indigo"><Icon name="book" size={19}/></span><div><span className="stat-label">历年真题</span><strong>{papers.length}<small>套</small></strong><span className="stat-caption">{dates.length ? `${dates[dates.length - 1].replace('-', '.')} — ${dates[0].replace('-', '.')}` : '等待导入'}</span></div></div>
      <div className="stat-tile"><span className="stat-icon violet"><Icon name="layers" size={19}/></span><div><span className="stat-label">客观题目</span><strong>{objectiveTotal.toLocaleString()}<small>道</small></strong><span className="stat-caption">听力 · 选词 · 匹配 · 阅读</span></div></div>
      <div className="stat-tile"><span className="stat-icon amber"><Icon name="clock" size={19}/></span><div><span className="stat-label">进行中</span><strong>{inProgress}<small>套</small></strong><span className="stat-caption">随时继续，进度自动保存</span></div></div>
      <div className="stat-tile"><span className="stat-icon green"><Icon name="check" size={19}/></span><div><span className="stat-label">已完成</span><strong>{finished}<small>套</small></strong><span className="stat-caption">每一份积累都有迹可循</span></div></div>
    </section>

    <section className="papers-section">
      <div className="section-heading"><div><h2>历年试卷</h2><p>按考次整理，同一次考试的各套试卷放在一起。</p></div></div>
      {err && <div className="notice error" role="alert">{err}<button onClick={() => setErr('')} aria-label="关闭错误提示"><Icon name="close" size={16}/></button></div>}
      <div className="library-toolbar">
        <label className="search-field"><Icon name="search" size={18}/><input aria-label="搜索试卷" placeholder="搜索年份、月份或套次，如 2024 12" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button onClick={() => setSearch('')} aria-label="清空搜索"><Icon name="close" size={14}/></button>}</label>
        <div className="segmented" role="group" aria-label="练习状态">
          {[['', '全部'], ...Object.entries(STATUS)].map(([s, cn]) => <button key={s} className={status === s ? 'active' : ''} aria-pressed={status === s} onClick={() => setStatus(s)}>{cn}<span>{statusCounts[s] || 0}</span></button>)}
        </div>
        <div className="filter-selects">
          <select aria-label="考试日期" value={date} onChange={e => setDate(e.target.value)}><option value="">全部日期</option>{dates.map(d => <option key={d} value={d}>{d.replace('-', ' 年 ')} 月</option>)}</select>
          <select aria-label="题型" value={section} onChange={e => setSection(e.target.value)}><option value="">全部题型</option>{Object.entries(SECTIONS).map(([s, cn]) => <option key={s} value={s}>{cn}</option>)}</select>
          <select aria-label="试卷排序" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">最新优先</option><option value="oldest">最早优先</option></select>
        </div>
      </div>
      <div className="library-meta"><span>共 <b>{groups.length}</b> 次考试 · <b>{shown.length}</b> 套试卷{(date || section || status || search) && <button className="text-button" onClick={reset}>重置筛选</button>}</span></div>

      {!shown.length ? <div className="empty-state card"><Icon name="search" size={32}/><h3>没有找到符合条件的试卷</h3><p>换个关键词，或清除筛选条件后再试。</p><button onClick={reset}>清除筛选</button></div>
        : <div className="exam-grid">{groups.map(g => <article className="exam-card" key={g.key}>
          <header className="exam-head">
            <div className="exam-date"><span className="exam-year">{g.year}</span><span className="exam-month">{g.month} 月</span></div>
            <span className="exam-count">{g.papers.length} 套</span>
          </header>
          <ul className="set-list">{g.papers.map(p => {
            const noKey = p.objective_total - p.objective_keyed
            const missing = Object.entries(SECTIONS).filter(([s]) => !p.question_counts?.[s]?.n).map(([, cn]) => cn)
            const present = Object.entries(SECTIONS).filter(([s]) => p.question_counts?.[s]?.n).map(([, cn]) => cn)
            const detail = Object.entries(SECTIONS).map(([s, cn]) => `${cn}：${p.question_counts?.[s]?.n || 0} 题`).join('\n')
            return <li key={p.paper_key} className={`set-row ${p.status}`}>
              <span className="set-no" aria-hidden="true"><small>第</small>{p.set_no}<small>套</small></span>
              <div className="set-info">
                <div className="set-title"><b>第 {p.set_no} 套</b><span className={`status-pill ${p.status}`}>{STATUS[p.status] || '未开始'}</span></div>
                <div className="set-meta" title={detail}>
                  <span>{p.objective_total} 道客观题</span>
                  <span className={`audio-label${p.has_audio ? ' available' : ''}`}><Icon name="headphones" size={14}/>{p.has_audio ? '有音频' : '无音频'}</span>
                  {Object.keys(p.shared_sources || {}).length > 0 && <span className="missing-chip" title={Object.entries(p.shared_sources).map(([sec, source]: any) => `${SECTIONS[sec] || sec}：与 ${source.source_slug} 共用（来源已标明）`).join('\n')}>部分材料共用</span>}
                  {missing.length > 0 && <span className="missing-chip">{missing.length > 2 ? `仅含${present.join('、') || '原卷'}` : `缺${missing.join('、')}`}</span>}
                  {noKey > 0 && <span className="missing-chip" title="缺少标准答案的题可练习，但不参与判分">{noKey} 题待核对</span>}
                </div>
                {p.status === 'in_progress' && <div className="set-progress"><div className="progress-track"><span style={{ width: `${Math.min(100, (p.active_answered / Math.max(1, p.objective_total)) * 100)}%` }}/></div><span>{p.active_answered}/{p.objective_total}</span></div>}
              </div>
              <div className="set-actions">
                <button className={`paper-action${p.status === 'in_progress' ? ' primary' : ''}`} disabled={!!busy || switching} onClick={() => start(p)} aria-label={`${p.status === 'in_progress' ? '继续练习' : p.status === 'done' ? '复盘已完成练习' : '开始练习'}：${paperTitle(p)}`}>{busy === p.paper_key ? '打开中' : p.status === 'in_progress' ? '继续' : p.status === 'done' ? '复盘' : '开始'}<Icon name="arrow" size={15}/></button>
                {p.active_session_id && p.last_submitted_session_id && <button className="restart-link" disabled={!!busy || switching} onClick={() => nav(`/practice/${p.last_submitted_session_id}`)}>查看上次交卷</button>}
                {(p.active_session_id || p.last_submitted_session_id) && <button className="restart-link" title="新建空白练习，保留之前的作答" disabled={!!busy || switching} onClick={() => start(p, true)}>重新开始</button>}
              </div>
            </li>
          })}</ul>
        </article>)}</div>}
    </section>
    <div className="library-footnote"><Icon name="shield" size={16}/><span>练习进度自动保存在本机。写作与翻译可记录草稿、查看参考解析，由你自行评阅。</span></div>
  </div>
}
