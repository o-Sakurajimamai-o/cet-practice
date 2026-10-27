import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getSession, saveState, markRevealed, submitSession,
  questionDetail, addFavorite, delFavorite, favoritesList, restartSession,
} from '../api'
import AudioPlayer from '../components/AudioPlayer'
import MaterialPanel from '../components/MaterialPanel'
import MarkableMaterial from '../components/MarkableMaterial'
import QuestionCard from '../components/QuestionCard'
import Icon from '../components/Icon'
import ThemeToggle from '../components/ThemeToggle'
import { SessionSaver, type SessionProgress } from '../sessionSaver'

const SECTION_ORDER = ['listening', 'cloze', 'matching', 'reading1', 'reading2', 'writing', 'translation']
const SECTION_CN: Record<string, string> = {
  listening: '听力', cloze: '选词填空', matching: '长篇阅读',
  reading1: '仔细阅读一', reading2: '仔细阅读二', writing: '写作', translation: '翻译',
}

export default function Practice() {
  const { sid } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [currentUid, setCurrentUid] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [audioPos, setAudioPos] = useState(0)
  const [fontScale, setFontScale] = useState(1)
  const [activeSection, setActiveSection] = useState<string>('listening')
  const [selectedBlank, setSelectedBlank] = useState<number | null>(null)
  const [analysisMap, setAnalysisMap] = useState<Record<string, any>>({})
  const [favSet, setFavSet] = useState<Set<string>>(new Set())
  const [savedTip, setSavedTip] = useState('')
  const [saveError, setSaveError] = useState('')
  const [actionError, setActionError] = useState('')
  const [saveConflict, setSaveConflict] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
  const loaded = useRef(false)
  const mounted = useRef(true)
  const locked = useRef(false)
  const submittedRef = useRef(false)
  const [saver] = useState(() => new SessionSaver(payload => saveState(Number(sid), payload)))
  const saveTimer = useRef<number | null>(null)
  const tipTimer = useRef<number | null>(null)
  const clock = useRef<{ base: number; started: number } | null>(null)
  const audioPositions = useRef<Record<string, number>>({})
  const sectionPositions = useRef<Record<string, string>>({})
  const pendingReveals = useRef(new Set<Promise<any>>())
  const submitted = !!data?.session?.submitted_at

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (tipTimer.current != null) clearTimeout(tipTimer.current)
    }
  }, [])

  const updateProgress = useCallback((patch: Partial<SessionProgress>) => {
    saver.update(patch, !submittedRef.current)
    if (!mounted.current) return
    const next = saver.progress
    setAnswers(next.answers)
    setCurrentUid(next.current_uid)
    setElapsed(next.elapsed_sec)
    setAudioPos(next.audio_pos)
  }, [saver])

  const refreshClock = useCallback((updateUi = true) => {
    if (!clock.current || submittedRef.current) return
    const seconds = clock.current.base + Math.max(0, Math.floor((Date.now() - clock.current.started) / 1000))
    if (updateUi) updateProgress({ elapsed_sec: seconds })
    else saver.update({ elapsed_sec: seconds })
  }, [saver, updateProgress])

  // 载入会话
  useEffect(() => {
    let active = true
    getSession(Number(sid))
      .then((d) => {
        if (!active) return
        const firstQ = d.questions.find((q: any) => SECTION_ORDER.includes(q.section))
        const restoredQ = d.questions.find((q: any) => q.uid === d.session.current_uid)
        const initialQ = restoredQ || firstQ
        const audioPaper = d.session.audio_paper_key || d.paper.paper_key
        saver.initialize({
          answers: d.session.answers || {}, current_uid: initialQ?.uid || null,
          elapsed_sec: d.session.elapsed_sec || 0, audio_pos: d.session.audio_pos || 0,
          audio_paper_key: audioPaper,
        }, d.session.state_revision || 0)
        submittedRef.current = !!d.session.submitted_at
        audioPositions.current = { [audioPaper]: d.session.audio_pos || 0 }
        if (initialQ) sectionPositions.current[initialQ.section] = initialQ.uid
        setData(d)
        loaded.current = true
        updateProgress({})
        setActiveSection(initialQ?.section || 'listening')
        setSelectedBlank(initialQ?.qtype === 'blank' ? initialQ.q_no : null)
        if (restoredQ) requestAnimationFrame(() => {
          if (active) document.getElementById(`q-${restoredQ.uid}`)?.scrollIntoView({ block: 'start' })
        })
      })
      .catch((e) => { if (active) setErr(String(e.message || e)) })
    return () => { active = false }
  }, [sid, saver, updateProgress])

  // 收藏状态（错题回看/复习页维护，这里只读常见收藏）
  useEffect(() => {
    let active = true
    favoritesList().then((d) => { if (active) setFavSet(new Set(d.favorites.map((f: any) => f.uid))) }).catch(() => { if (active) setActionError('收藏状态加载失败，请刷新重试。') })
    return () => { active = false }
  }, [])

  // 字号持久化
  useEffect(() => {
    let stored = 1
    try { stored = Number(localStorage.getItem('fontScale') || 1) } catch { /* Font controls still work without browser storage. */ }
    const v = Number.isFinite(stored) ? Math.min(1.5, Math.max(0.8, stored)) : 1
    setFontScale(v)
    document.documentElement.style.setProperty('--font-scale', String(v))
  }, [])

  // 计时
  useEffect(() => {
    if (!data || submitted || submitting || restarting) return
    clock.current = { base: saver.progress.elapsed_sec, started: Date.now() }
    const id = setInterval(() => refreshClock(), 1000)
    return () => { refreshClock(false); clock.current = null; clearInterval(id) }
  }, [!!data, submitted, submitting, restarting, saver, refreshClock])

  // 自动保存：变更后 800ms；且每 15s 兜底
  const persist = useCallback((silent = false): Promise<void> => {
    if (!loaded.current || submittedRef.current) return Promise.resolve()
    return saver.save()
      .then(() => {
        if (!mounted.current) return
        setSaveError('')
        if (!silent) {
          setSavedTip('已自动保存 ' + new Date().toLocaleTimeString())
          if (tipTimer.current != null) clearTimeout(tipTimer.current)
          tipTimer.current = window.setTimeout(() => setSavedTip(''), 1800)
        }
      })
      .catch((e) => {
        if (mounted.current) {
          setSaveConflict(!!saver.conflict)
          setSavedTip('')
          setSaveError(saver.conflict
            ? '另一页面已保存这份练习的新进度。本页作答已保留，未覆盖另一页面；请先下载本页作答，再核对其他练习页面。'
            : '进度尚未保存，请保持页面打开并重试。')
        }
        throw e
      })
  }, [saver])

  // 防抖定时器挂在 ref 上，避免被每秒计时的重渲染反复重置
  useEffect(() => {
    if (!saver.dirty || submitted || submitting || restarting || saveConflict) return
    if (saveTimer.current != null) return // 已有待触发的保存
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      persist().catch(() => {})
    }, 800)
  }, [answers, currentUid, audioPos, persist, submitted, submitting, restarting, saver, saveConflict])

  useEffect(() => {
    const id = setInterval(() => {
      if (saver.dirty && !locked.current && !saver.conflict) persist(true).catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [persist, saver])

  // 关闭/刷新前尽力保存
  useEffect(() => {
    const flush = () => {
      refreshClock(false)
      if (loaded.current && saver.dirty && !submittedRef.current) {
        const payload = saver.latestPayload()
        if (!payload) return
        const body = JSON.stringify(payload)
        if (!navigator.sendBeacon?.(`/api/sessions/${sid}`, new Blob([body], { type: 'application/json' }))) {
          fetch(`/api/sessions/${sid}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
        }
      }
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    const onHidden = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
      if (saveTimer.current != null) { clearTimeout(saveTimer.current); saveTimer.current = null }
      flush()
    }
  }, [sid, saver, refreshClock])

  function focusQuestion(q: any, scroll = false) {
    if (!q || locked.current) return
    updateProgress({ current_uid: q.uid })
    sectionPositions.current[q.section] = q.uid
    setActiveSection(q.section)
    setSelectedBlank(q.qtype === 'blank' ? q.q_no : null)
    if (scroll) requestAnimationFrame(() => document.getElementById(`q-${q.uid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function setAnswer(uid: string, v: any) {
    if (locked.current || submittedRef.current || saver.conflict) return
    const q = data?.questions.find((item: any) => item.uid === uid)
    focusQuestion(q)
    updateProgress({ answers: { ...saver.progress.answers, [uid]: v } })
  }

  function changeFont(d: number) {
    const v = Math.min(1.5, Math.max(0.8, Number((fontScale + d).toFixed(2))))
    setFontScale(v)
    try { localStorage.setItem('fontScale', String(v)) } catch { /* Apply the chosen font for this visit. */ }
    document.documentElement.style.setProperty('--font-scale', String(v))
  }

  async function onReveal(uid: string) {
    if (locked.current) throw new Error('正在保存练习，请稍候再查看解析。')
    if (!submittedRef.current) {
      const record = markRevealed(Number(sid), uid)
      pendingReveals.current.add(record)
      try { await record } finally { pendingReveals.current.delete(record) }
    }
    const d = await questionDetail(uid)
    if (mounted.current) setAnalysisMap((m) => ({ ...m, [uid]: d }))
    return d
  }

  async function toggleFav(uid: string) {
    if (favSet.has(uid)) { await delFavorite(uid); setFavSet((s) => { const n = new Set(s); n.delete(uid); return n }) }
    else { await addFavorite(uid); setFavSet((s) => new Set(s).add(uid)) }
  }

  function completeSubmission(result: any, fullData?: any) {
    submittedRef.current = true
    saver.dirty = false
    if (fullData) {
      setData(fullData)
      saver.update({ answers: fullData.session.answers || saver.progress.answers }, false)
      setAnswers(saver.progress.answers)
    } else {
      setData((previous: any) => ({ ...previous, session: { ...previous.session, submitted_at: result.submitted_at, result } }))
    }
    setConfirming(false)
    setSaveError('')
    setActionError('')
  }

  async function doSubmit() {
    if (locked.current || submittedRef.current || saver.conflict) return
    refreshClock()
    clock.current = null
    locked.current = true
    setSubmitting(true)
    setActionError('')
    let accepted = false
    try {
      // 交卷前强制把待保存的作答落库，避免与防抖竞态
      if (saveTimer.current != null) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      await Promise.all([...pendingReveals.current])
      await persist(true)
      const response = await submitSession(Number(sid))
      if (response.result) { completeSubmission(response.result); accepted = true }
      const d = await getSession(Number(sid))
      completeSubmission(d.session.result, d)
    } catch (e: any) {
      if (accepted) {
        setActionError('已交卷，结果已保存。完整题目详情暂未加载，可重新打开练习或逐题查看解析。')
      } else {
        // A lost POST response must not make an already submitted session editable.
        try {
          const d = await getSession(Number(sid))
          if (d.session.submitted_at) { completeSubmission(d.session.result, d); accepted = true }
        } catch { /* Keep the local answers if the server is still unreachable. */ }
        if (!accepted) setActionError('交卷未确认完成：' + String(e.message || e) + '。当前作答仍保留在页面，请重试。')
      }
    } finally { locked.current = false; setSubmitting(false) }
  }

  async function startAgain() {
    if (locked.current || saver.conflict) return
    refreshClock()
    clock.current = null
    locked.current = true
    setRestarting(true)
    try {
      if (saveTimer.current != null) { clearTimeout(saveTimer.current); saveTimer.current = null }
      await persist(true)
      const next = await restartSession(Number(sid))
      nav(`/practice/${next.session_id}`)
    } catch (e: any) { setActionError('重新开始未完成：' + String(e.message || e)) }
    finally { locked.current = false; setRestarting(false) }
  }

  function downloadLocalAnswers() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ session_id: Number(sid), ...saver.progress }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `cet6-local-answers-${sid}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 分组必须在所有提前 return 之前（Hook 顺序稳定）
  const bySection = useMemo(() => {
    const m: Record<string, any[]> = {}
    for (const s of SECTION_ORDER) m[s] = []
    for (const q of data?.questions || []) (m[q.section] = m[q.section] || []).push(q)
    return m
  }, [data])

  // Keep the active section tab visible when the tab strip scrolls horizontally on small screens.
  useEffect(() => {
    toolbarRef.current?.querySelector('.section-tabs .active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeSection, !!data])

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current, page = pageRef.current
    if (!toolbar || !page) return
    const measure = () => page.style.setProperty('--practice-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [!!data])

  useLayoutEffect(() => {
    const page = pageRef.current
    const nav = page?.querySelector<HTMLElement>('.qnav-card')
    if (!page || !nav) return
    const measure = () => page.style.setProperty('--question-nav-height', `${Math.ceil(nav.getBoundingClientRect().height)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [!!data, activeSection])

  if (err) return <div className="empty-state card"><Icon name="alert" size={32}/><h3>练习加载失败</h3><p>{err}</p><button onClick={() => nav('/')}>返回试卷库</button></div>
  if (!data) return <div className="loading" role="status"><span className="spinner"/>正在加载试卷…</div>

  const { questions, paper } = data
  const result = data.session.result
  const secQuestions = bySection[activeSection] || []
  const focusedQuestion = secQuestions.find((q: any) => q.uid === currentUid) || secQuestions[0]
  const materialPaper = focusedQuestion?.paper_key || paper.paper_key
  const sectionPapers = [...new Set<string>(secQuestions.map((q: any) => q.paper_key || paper.paper_key))]
  const visibleQuestions = secQuestions.filter((q: any) => !q.paper_key || q.paper_key === materialPaper)
  const sections = data.sections_by_paper?.[materialPaper] || data.sections || {}
  const audio_url = data.audio_by_paper ? data.audio_by_paper[materialPaper] : data.audio_url
  const mat = sections[activeSection]?.main || Object.values(sections[activeSection] || {})[0]
  const wordBank = mat?.content?.word_bank || []
  const paragraphLabels = (mat?.content?.paragraphs || []).map((p: any) => p.label)
  const wordAnswer: Record<number, string> = {}
  for (const q of bySection.cloze || []) {
    if (q.paper_key && q.paper_key !== materialPaper) continue
    const v = answers[q.uid]
    if (v) wordAnswer[q.q_no] = v
  }

  const busyNow = submitting || restarting
  const questionButtons = visibleQuestions.map((q: any) => {
                const ans = answers[q.uid]
                let cls = 'qn'
                if (ans) cls += ' answered'
                if (q.uid === currentUid) cls += ' current'
                if (favSet.has(q.uid)) cls += ' fav'
                if (submitted && result?.detail?.[q.uid]) {
                  const v = result.detail[q.uid].verdict
                  if (v === 'correct') cls += ' correct'
                  else if (v === 'wrong') cls += ' wrong'
                  else if (v === 'no_key') cls += ' nokey'
                }
                return (
                  <button key={q.uid} className={cls} aria-label={`第 ${q.q_no} 题`} aria-current={q.uid === currentUid ? 'true' : undefined}
                    disabled={busyNow}
                    onClick={(e) => { focusQuestion(q, true); e.currentTarget.closest('details')?.removeAttribute('open') }}
                  >{q.q_no}</button>
                )
              })

  // 客观题进度（不含作文/翻译）
  const objQs = questions.filter((q: any) => q.qtype !== 'essay' && q.qtype !== 'translation')
  const objAnswered = objQs.filter((q: any) => answers[q.uid]).length
  const fullMode = data.session.mode === 'full'
  const availableSections = SECTION_ORDER.filter(s => bySection[s]?.length)
  const currentSectionIndex = availableSections.indexOf(activeSection)
  function goSection(section: string) {
    focusQuestion(bySection[section].find(q => q.uid === sectionPositions.current[section]) || bySection[section][0])
    if (submitted) requestAnimationFrame(() => {
      const split = pageRef.current?.querySelector('.split')
      if (split) window.scrollTo({ top: Math.max(0, window.scrollY + split.getBoundingClientRect().top - (toolbarRef.current?.offsetHeight || 0) - 8), behavior: 'instant' })
    })
    else window.scrollTo({ top: 0, behavior: 'instant' })
    pageRef.current?.querySelector('.material')?.scrollTo({ top: 0 })
  }

  return (
    <div className="practice-page" ref={pageRef}>
      <div className="practice-toolbar" ref={toolbarRef}>
        <div className="practice-head">
          <button className="icon-btn back-btn" aria-label="返回试卷库" title="返回试卷库" disabled={busyNow} onClick={async () => { try { refreshClock(); await persist(true); nav('/') } catch { /* Keep unsaved answers visible. */ } }}><Icon name="back" size={19}/></button>
          <div className="practice-title">
            <b className="title">{fullMode ? `${paper.year} 年 ${paper.month} 月 · 第 ${paper.set_no} 套` : `${materialPaper} · 当前材料`}</b>
            <span>{String(materialPaper).startsWith('cet4-') ? '英语四级' : '英语六级'} · {fullMode ? '整卷练习' : '错题重做'} · 客观题已答 {objAnswered}/{objQs.length}{savedTip && <em className="saved-tip"><Icon name="check" size={13}/>{savedTip}</em>}</span>
          </div>
          <span className="timer" title="已用时间"><Icon name="clock" size={16}/>{fmtElapsed(elapsed)}</span>
          <div className="practice-actions">
            <div className="font-ctl" role="group" aria-label="正文字号">
              <button onClick={() => changeFont(-0.05)} aria-label="缩小字号" title="缩小字号">A<sup>−</sup></button>
              <span aria-hidden="true">{Math.round(fontScale * 100)}%</span>
              <button onClick={() => changeFont(0.05)} aria-label="放大字号" title="放大字号">A<sup>+</sup></button>
            </div>
            <ThemeToggle compact/>
            <button className="practice-restart ghost" disabled={busyNow || saveConflict} onClick={startAgain} title="开启空白练习，之前的作答仍保留"><Icon name="restart" size={16}/><span>{restarting ? '正在重新开始…' : '重新开始'}</span></button>
            {!submitted ? (
              <button className="primary submit-btn" disabled={busyNow || saveConflict} onClick={() => setConfirming(true)}><Icon name="flag" size={16}/>{submitting ? '正在交卷…' : '交卷'}</button>
            ) : (
              <span className="tag ok submitted-tag"><Icon name="check" size={14}/>已交卷 {data.session.submitted_at}</span>
            )}
          </div>
        </div>

        <div className="section-tabs" role="tablist" aria-label="题型">
          {SECTION_ORDER.filter((s) => bySection[s]?.length).map((s) => {
            const done = bySection[s].filter((q: any) => answers[q.uid]).length
            const total = bySection[s].length
            return (
              <button
                key={s}
                role="tab"
                aria-selected={activeSection === s}
                className={`${activeSection === s ? 'active' : ''}${done === total ? ' complete' : ''}`}
                disabled={busyNow}
                onClick={() => goSection(s)}
              >
                <span>{SECTION_CN[s]}</span><small>{done}/{total}</small>
              </button>
            )
          })}
        </div>

        {activeSection === 'listening' && (
          <AudioPlayer
            key={materialPaper}
            src={audio_url}
            hasAudio={!!audio_url}
            startPos={audioPositions.current[materialPaper] || 0}
            paused={busyNow}
            onPos={(p, updateUi = true) => {
              audioPositions.current[materialPaper] = p
              saver.update({ audio_pos: p, audio_paper_key: materialPaper }, !submittedRef.current)
              if (updateUi) updateProgress({})
            }}
          />
        )}
        <div className="toolbar-progress" aria-hidden="true"><span style={{ width: `${objQs.length ? (objAnswered / objQs.length) * 100 : 0}%` }}/></div>
      </div>

      {saveError && <div className="notice error" role="alert"><span><Icon name="alert" size={16}/>{saveError}</span>{saveConflict
        ? <button onClick={downloadLocalAnswers}>下载本页作答</button>
        : <button disabled={busyNow} onClick={() => persist().catch(() => {})}>重试保存</button>}</div>}
      {actionError && <div className="notice error" role="alert"><span><Icon name="alert" size={16}/>{actionError}</span><button onClick={() => setActionError('')} aria-label="关闭操作提示">关闭</button></div>}

      {confirming && (
        <div className="modal-backdrop" onClick={() => { if (!submitting) setConfirming(false) }}>
          <div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Escape' && !submitting) setConfirming(false) }}>
            <span className="confirm-icon"><Icon name="flag" size={24}/></span>
            <h3 id="confirm-title">确认交卷？</h3>
            <div className="confirm-progress">
              <div><b>{objAnswered}</b><span>已作答</span></div>
              <div><b>{objQs.length - objAnswered}</b><span>未作答</span></div>
              <div><b>{fmtElapsed(elapsed)}</b><span>用时</span></div>
            </div>
            <p className="muted">未作答的客观题将计为未作答；缺少标准答案的题不判分；作文与翻译不参与统计（未填写草稿也可交卷）。</p>
            <div className="confirm-actions">
              <button disabled={busyNow} onClick={() => setConfirming(false)} autoFocus>继续做题</button>
              <button className="primary" disabled={busyNow || saveConflict} onClick={doSubmit}>{submitting ? '保存并交卷中…' : '确认交卷'}</button>
            </div>
          </div>
        </div>
      )}

      {submitted && result && <ResultHero result={result} />}

      <div className="section-side-switch" aria-label="切换题型">
        {[-1, 1].map(delta => { const target = availableSections[currentSectionIndex + delta]; return <button key={delta} className={delta < 0 ? 'previous' : 'next'} disabled={!target || busyNow} aria-label={target ? `${delta < 0 ? '上一部分' : '下一部分'}：${SECTION_CN[target]}` : (delta < 0 ? '没有上一部分' : '没有下一部分')} title={target ? SECTION_CN[target] : ''} onClick={() => target && goSection(target)}><span aria-hidden="true">{delta < 0 ? '‹' : '›'}</span><small>{target ? SECTION_CN[target] : '已到底'}</small></button> })}
      </div>
      <details className="mobile-qnav">
        <summary>题号导航</summary>
        <div className="mobile-qnav-panel"><div className="qnav-head">题号导航</div><div className="qnav">{questionButtons}</div></div>
      </details>
      <MarkableMaterial key={`${materialPaper}:${activeSection}`} paper={materialPaper} section={activeSection}>
      <div className="split">
        <div className="material">
          <MaterialPanel
            paperKey={materialPaper}
            section={activeSection}
            mat={mat}
            selectedBlank={selectedBlank}
            disabled={busyNow}
            availableBlanks={visibleQuestions.filter((q: any) => q.qtype === 'blank').map((q: any) => q.q_no)}
            onBlankClick={(no) => {
              const q = (bySection.cloze || []).find((x: any) => x.q_no === no && (!x.paper_key || x.paper_key === materialPaper))
              focusQuestion(q, true)
            }}
            wordAnswer={wordAnswer}
            showTranscript={submitted}
          />
        </div>
        <div className="questions-col">
          {sectionPapers.length > 1 && <div className="redo-paper-switch">
            <label>当前试卷 <select aria-label="切换重做试卷" value={materialPaper} disabled={busyNow}
              onChange={e => focusQuestion(secQuestions.find((q: any) => q.paper_key === e.target.value))}>
              {sectionPapers.map(key => <option key={key} value={key}>{key}（{secQuestions.filter((q: any) => q.paper_key === key).length} 题）</option>)}
            </select></label>
            <span className="muted small">题目与左侧材料按试卷一起切换。</span>
          </div>}
          <div className="qnav-card sticky-qnav">
            <div className="qnav-head"><span>题号导航</span><span className="qnav-legend">
              {submitted ? <><i className="lg correct"/>正确<i className="lg wrong"/>错误</> : <><i className="lg answered"/>已答<i className="lg"/>未答</>}<i className="lg fav"/>收藏
            </span></div>
            <div className="qnav">
              {questionButtons}
            </div>
          </div>

          {visibleQuestions.map((q: any, index: number) => {
            const group = activeSection === 'listening' ? (mat?.content?.groups || []).find((g: any) => g.key === q.group_key || (q.q_no >= g.from && q.q_no <= g.to)) : null
            const previous = visibleQuestions[index - 1]
            const groupStart = group && (!previous || !(previous.q_no >= group.from && previous.q_no <= group.to))
            const ownSections = data.sections_by_paper?.[q.paper_key] || sections
            const ownMat = ownSections[q.section]?.main || Object.values(ownSections[q.section] || {})[0] as any
            const extra = analysisMap[q.uid] || {}
            const qd = { ...extra, ...q }
            const analysisData = extra.materials
              ? extra
              : { materials: Object.values(ownSections[q.section] || {}), note: '' }
            return (
              <Fragment key={q.uid}>
              {groupStart && <div className="listening-divider"><b>听力篇目 {(mat?.content?.groups || []).indexOf(group) + 1}</b><span>第 {group.from}–{group.to} 题</span></div>}
              <QuestionCard
                q={qd}
                answer={answers[q.uid]}
                onAnswer={(v) => setAnswer(q.uid, v)}
                submitted={submitted}
                saving={busyNow || saveConflict}
                detail={result?.detail?.[q.uid]}
                isCurrent={q.uid === currentUid}
                favorite={favSet.has(q.uid)}
                onToggleFav={() => toggleFav(q.uid)}
                onReveal={() => onReveal(q.uid)}
                analysisData={analysisData}
                paragraphLabels={q.qtype === 'match' ? (ownMat?.content?.paragraphs || []).map((p: any) => p.label) : paragraphLabels}
              />
              </Fragment>
            )
          })}

          {activeSection === 'cloze' && wordBank.length === 0 && (
            <div className="card muted">本套选词填空词库缺失（待核对）。</div>
          )}
        </div>
      </div>
      </MarkableMaterial>
    </div>
  )
}

function ResultHero({ result }: { result: any }) {
  const graded = (result.correct || 0) + (result.wrong || 0)
  const pct = result.accuracy != null ? result.accuracy * 100 : null
  const R = 52, C = 2 * Math.PI * R
  return (
    <section className="card result-hero" aria-label="交卷结果">
      <div className="result-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="ring-track"/>
          <circle cx="60" cy="60" r={R} className="ring-value" strokeDasharray={`${((pct ?? 0) / 100) * C} ${C}`}/>
        </svg>
        <div className="ring-label"><b>{pct != null ? `${pct.toFixed(1)}%` : '—'}</b><span>正确率</span></div>
      </div>
      <div className="result-body">
        <h2>练习完成</h2>
        <p className="muted">客观题正确率 = 正确 {result.correct} / 已作答且有答案 {graded}（不是四六级考试分数）</p>
        <div className="result-stats">
          <div className="rs correct"><b>{result.correct}</b><span>正确</span></div>
          <div className="rs wrong"><b>{result.wrong}</b><span>错误</span></div>
          <div className="rs"><b>{result.unanswered}</b><span>未作答</span></div>
          <div className="rs"><b>{result.no_key}</b><span>无答案不判分</span></div>
        </div>
        {result.note && <p className="muted small">{result.note}</p>}
      </div>
      <div className="result-sections">
        {Object.entries(result.per_section || {}).map(([k, v]: any) => {
          const total = (v.correct || 0) + (v.wrong || 0) + (v.unanswered || 0) + (v.no_key || 0)
          const w = (n: number) => `${total ? (n / total) * 100 : 0}%`
          return (
            <div key={k} className="rsec">
              <div className="rsec-head"><span>{SECTION_CN[k] || k}</span><span>对 {v.correct} · 错 {v.wrong} · 未答 {v.unanswered}{v.no_key ? ` · 无答案 ${v.no_key}` : ''}</span></div>
              <div className="rsec-bar"><i className="c" style={{ width: w(v.correct || 0) }}/><i className="w" style={{ width: w(v.wrong || 0) }}/></div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function fmtElapsed(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return (h > 0 ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
