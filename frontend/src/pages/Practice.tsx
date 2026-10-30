import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getSession, saveState, markRevealed, submitSession,
  questionDetail, addFavorite, delFavorite, favoritesList, restartSession,
} from '../api'
import AudioPlayer from '../components/AudioPlayer'
import MaterialPanel from '../components/MaterialPanel'
import MarkableMaterial from '../components/MarkableMaterial'
import { parseReadingTranslation } from '../readingTranslation'
import QuestionCard from '../components/QuestionCard'
import Icon from '../components/Icon'
import ThemeToggle from '../components/ThemeToggle'
import { KaoyanGroupSwitch, KaoyanPdfLinks, KaoyanScore } from '../components/KaoyanPractice'
import { SessionSaver, type SessionProgress } from '../sessionSaver'
import {
  EXAM_NAME, examOf, groupLabel, paperShort, paperTitle, resultSectionLabel, resultSectionRank, sectionLabel, sectionOrder, type Exam,
} from '../exam'
import { pickMaterial } from '../kaoyan'

// Kaoyan sections with several materials: the right column shows one group (Text n, Part A/B) at a time.
const GROUPED_SECTIONS = ['reading1', 'writing']
// Kaoyan sections whose paragraph translations can be shown under the English after submission.
const KAOYAN_BILINGUAL = ['cloze', 'reading1', 'matching']

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
  const navigationRef = useRef<HTMLElement>(null)
  const [layout, setLayout] = useState({ rail: false, columns: false })
  const [expandedTranslation, setExpandedTranslation] = useState<string | null>(null)
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
  const groupPositions = useRef<Record<string, string>>({})
  const pendingReveals = useRef(new Set<Promise<any>>())
  const submitted = !!data?.session?.submitted_at
  const exam: Exam = examOf(data?.paper)
  const translationPaper = data?.questions.find((q: any) => q.uid === currentUid)?.paper_key || data?.paper?.paper_key || ''
  const translationScope = `${translationPaper}:${activeSection}`
  const readingTranslationOpen = submitted && ['reading1', 'reading2'].includes(activeSection) && expandedTranslation === translationScope

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
        const order = sectionOrder(examOf(d.paper))
        const firstQ = d.questions.find((q: any) => order.includes(q.section))
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
        setActiveSection(initialQ?.section || order[0])
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
    groupPositions.current[`${q.paper_key}:${q.section}:${q.group_key}`] = q.uid
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
    // With the session, a kaoyan reveal before submission returns only this question's own references (CONTRACT §9.2).
    const d = await questionDetail(uid, Number(sid))
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
    link.download = `${exam === 'kaoyan' ? 'kaoyan' : 'cet6'}-local-answers-${sid}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 分组必须在所有提前 return 之前（Hook 顺序稳定）
  const bySection = useMemo(() => {
    const m: Record<string, any[]> = {}
    for (const s of sectionOrder(examOf(data?.paper))) m[s] = []
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

  // Measure the unreserved page width, so adding the rail cannot trigger a resize loop.
  useLayoutEffect(() => {
    const page = pageRef.current
    if (!page) return
    const measure = () => {
      const rect = page.getBoundingClientRect()
      const width = rect.width
      const railWidth = parseFloat(getComputedStyle(page).getPropertyValue('--practice-rail-width'))
      const minimumColumns = (420 + 440) * Math.max(1, fontScale) + 24
      const minimumRail = minimumColumns + railWidth + 24
      page.style.setProperty('--practice-rail-left', `${rect.right - railWidth}px`)
      const outerGutter = Math.min(rect.left, document.documentElement.clientWidth - rect.right)
      page.style.setProperty('--practice-switch-inset', `${Math.max(12, Math.round((outerGutter - 52) / 2))}px`)
      const tabs = toolbarRef.current?.querySelector<HTMLElement>('.section-tabs')
      const activeTab = tabs?.querySelector<HTMLElement>('.active')
      if (tabs && activeTab) {
        const strip = tabs.getBoundingClientRect(), tab = activeTab.getBoundingClientRect()
        if (tab.left < strip.left) tabs.scrollLeft -= strip.left - tab.left
        else if (tab.right > strip.right) tabs.scrollLeft += tab.right - strip.right
      }
      setLayout(previous => {
        // A 32px entry margin avoids flicker around the rail threshold.
        const rail = width >= minimumRail + (previous.rail ? 0 : 32)
        const columns = rail || width >= minimumColumns + (previous.columns ? 0 : 24)
        return rail === previous.rail && columns === previous.columns ? previous : { rail, columns }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(page)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [!!data, fontScale])

  useLayoutEffect(() => {
    const page = pageRef.current, navigation = navigationRef.current
    if (!page || !navigation) return
    const measure = () => page.style.setProperty('--question-nav-height', layout.rail ? '0px' : `${Math.ceil(navigation.getBoundingClientRect().height)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(navigation)
    return () => observer.disconnect()
  }, [!!data, layout.rail, activeSection])

  useLayoutEffect(() => {
    const list = navigationRef.current?.querySelector<HTMLElement>('.qnav')
    if (!list) return
    const keepCurrentVisible = () => {
      const button = list.querySelector<HTMLElement>('[aria-current="true"]')
      if (!button) return
      // Scroll only the navigator, leaving the passage and page position unchanged.
      const bounds = list.getBoundingClientRect(), target = button.getBoundingClientRect()
      if (target.top < bounds.top + 5) list.scrollTop -= bounds.top + 5 - target.top
      else if (target.bottom > bounds.bottom - 5) list.scrollTop += target.bottom - bounds.bottom + 5
    }
    keepCurrentVisible()
    const observer = new ResizeObserver(keepCurrentVisible)
    observer.observe(list)
    return () => observer.disconnect()
  }, [currentUid, activeSection, layout.rail, layout.columns, fontScale])

  if (err) return <div className="empty-state card"><Icon name="alert" size={32}/><h3>练习加载失败</h3><p>{err}</p><button onClick={() => nav('/')}>返回试卷库</button></div>
  if (!data) return <div className="loading" role="status"><span className="spinner"/>正在加载试卷…</div>

  const { questions, paper } = data
  const result = data.session.result
  const kaoyan = exam === 'kaoyan'
  const secQuestions = bySection[activeSection] || []
  const focusedQuestion = secQuestions.find((q: any) => q.uid === currentUid) || secQuestions[0]
  const materialPaper = focusedQuestion?.paper_key || paper.paper_key
  const sectionPapers = [...new Set<string>(secQuestions.map((q: any) => q.paper_key || paper.paper_key))]
  const visibleQuestions = secQuestions.filter((q: any) => !q.paper_key || q.paper_key === materialPaper)
  const sections = data.sections_by_paper?.[materialPaper] || data.sections || {}
  const audio_url = data.audio_by_paper ? data.audio_by_paper[materialPaper] : data.audio_url
  // CET keeps main-or-first; kaoyan takes the focused question's own group (Text n, Part A/B).
  const mat = pickMaterial(sections[activeSection], focusedQuestion?.group_key, exam)
  const readingTranslation = !kaoyan && submitted && ['reading1', 'reading2'].includes(activeSection)
    ? parseReadingTranslation(mat?.translation?.passage_translation) : []
  const wordBank = mat?.content?.word_bank || []
  const paragraphLabels = kaoyan ? [] : (mat?.content?.paragraphs || []).map((p: any) => p.label)
  const wordAnswer: Record<number, string> = {}
  for (const q of kaoyan ? [] : bySection.cloze || []) {
    if (q.paper_key && q.paper_key !== materialPaper) continue
    const v = answers[q.uid]
    if (v) wordAnswer[q.q_no] = v
  }
  const paperRow = (key: string) => data.papers_by_key?.[key] || (key === paper.paper_key ? paper : key)
  // Kaoyan reading and writing show one group at a time; the group follows current_uid, so a reload restores it.
  const groupKeys = kaoyan && GROUPED_SECTIONS.includes(activeSection) ? Object.keys(sections[activeSection] || {}) : []
  const currentGroup = focusedQuestion?.group_key || ''
  const groupTabs = groupKeys.length > 1 ? groupKeys.map(key => {
    const inGroup = visibleQuestions.filter((q: any) => q.group_key === key)
    return { key, label: groupLabel(activeSection, key, groupKeys.length), done: inGroup.filter((q: any) => answers[q.uid]).length, total: inGroup.length }
  }) : []
  const cardQuestions = groupTabs.length ? visibleQuestions.filter((q: any) => q.group_key === currentGroup) : visibleQuestions
  const partBVariant = kaoyan ? sharedVariant(bySection.matching) : null
  const kaoyanTranslation: string[] = kaoyan && submitted && KAOYAN_BILINGUAL.includes(activeSection) && Array.isArray(mat?.translation?.paragraphs)
    ? mat.translation.paragraphs : []
  const kaoyanBilingual = kaoyanTranslation.length > 0 && expandedTranslation === translationScope
  const verdicts = kaoyan && submitted
    ? Object.fromEntries(visibleQuestions.map((q: any) => [q.q_no, result?.detail?.[q.uid]?.verdict])) : undefined
  const pdfs: { label: string; path: string }[] = kaoyan && Array.isArray(data.pdfs_by_paper?.[materialPaper]) ? data.pdfs_by_paper[materialPaper] : []

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
                    onClick={() => focusQuestion(q, true)}
                  >{q.q_no}</button>
                )
              })

  // 客观题进度（不含作文/翻译）
  const objQs = questions.filter((q: any) => q.qtype !== 'essay' && q.qtype !== 'translation')
  const objAnswered = objQs.filter((q: any) => answers[q.uid]).length
  const fullMode = data.session.mode === 'full'
  const availableSections = sectionOrder(exam).filter(s => bySection[s]?.length)
  const currentSectionIndex = availableSections.indexOf(activeSection)
  const tabLabel = (s: string) => sectionLabel(s, exam, s === 'matching' ? partBVariant : null)
  function goSection(section: string) {
    focusQuestion(bySection[section].find(q => q.uid === sectionPositions.current[section]) || bySection[section][0])
    if (submitted) requestAnimationFrame(() => {
      const split = pageRef.current?.querySelector('.split')
      if (split) window.scrollTo({ top: Math.max(0, window.scrollY + split.getBoundingClientRect().top - (toolbarRef.current?.offsetHeight || 0) - (layout.rail ? 0 : navigationRef.current?.offsetHeight || 0) - 16), behavior: 'instant' })
    })
    else window.scrollTo({ top: 0, behavior: 'instant' })
    pageRef.current?.querySelector('.material')?.scrollTo({ top: 0 })
  }
  function selectGroup(key: string) {
    const inGroup = visibleQuestions.filter((q: any) => q.group_key === key)
    focusQuestion(inGroup.find((q: any) => q.uid === groupPositions.current[`${q.paper_key}:${q.section}:${key}`]) || inGroup[0])
    // A newly chosen text starts at its top; the page only scrolls when the material is above the viewport.
    requestAnimationFrame(() => {
      pageRef.current?.querySelector('.material')?.scrollTo({ top: 0 })
      const split = pageRef.current?.querySelector('.split')
      const offset = (toolbarRef.current?.offsetHeight || 0) + (layout.rail ? 0 : navigationRef.current?.offsetHeight || 0) + 16
      if (split && split.getBoundingClientRect().top < offset) window.scrollTo({ top: Math.max(0, window.scrollY + split.getBoundingClientRect().top - offset), behavior: 'instant' })
    })
  }
  function focusNumber(no: number, keyboard: boolean) {
    const q = secQuestions.find((x: any) => x.q_no === no && (!x.paper_key || x.paper_key === materialPaper))
    focusQuestion(q, true)
    // Keyboard users continue in the card they jumped to (a pointer tap must not open a phone keyboard);
    // the smooth scroll above stays in charge of the viewport.
    if (q && keyboard) requestAnimationFrame(() => document.getElementById(`q-${q.uid}`)
      ?.querySelector<HTMLElement>('.opt[tabindex="0"], .letter-row button:not(:disabled), textarea:not(:disabled)')?.focus({ preventScroll: true }))
  }

  return (
    <div className="practice-page" ref={pageRef} data-nav-layout={layout.rail ? 'rail' : 'top'} data-columns={layout.columns ? 'double' : 'single'}>
      <div className="practice-toolbar" ref={toolbarRef}>
        <div className="practice-head">
          <button className="icon-btn back-btn" aria-label="返回试卷库" title="返回试卷库" disabled={busyNow} onClick={async () => { try { refreshClock(); await persist(true); nav('/') } catch { /* Keep unsaved answers visible. */ } }}><Icon name="back" size={19}/></button>
          <div className="practice-title">
            <b className="title">{fullMode ? paperTitle(paperRow(paper.paper_key)) : `${kaoyan ? paperTitle(paperRow(materialPaper)) : materialPaper} · 当前材料`}</b>
            <span>{EXAM_NAME[examOf(paperRow(materialPaper))]} · {fullMode ? '整卷练习' : '错题重做'} · 客观题已答 {objAnswered}/{objQs.length}{savedTip && <em className="saved-tip"><Icon name="check" size={13}/>{savedTip}</em>}</span>
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
          {availableSections.map((s) => {
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
                <span>{tabLabel(s)}</span><small>{done}/{total}</small>
              </button>
            )
          })}
        </div>

        {activeSection === 'listening' && (
          <AudioPlayer
            key={materialPaper}
            src={audio_url}
            hasAudio={!!audio_url}
            noAudioEdition={data.audio_edition === 'NoAudio'}
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
            <p className="muted">{kaoyan
              ? '未作答的客观题将计为未作答；缺少参考答案的题不判分；翻译与写作不参与统计（未填写草稿也可交卷）。'
              : '未作答的客观题将计为未作答；缺少标准答案的题不判分；作文与翻译不参与统计（未填写草稿也可交卷）。'}</p>
            <div className="confirm-actions">
              <button disabled={busyNow} onClick={() => setConfirming(false)} autoFocus>继续做题</button>
              <button className="primary" disabled={busyNow || saveConflict} onClick={doSubmit}>{submitting ? '保存并交卷中…' : '确认交卷'}</button>
            </div>
          </div>
        </div>
      )}

      <aside className="practice-navigation" ref={navigationRef} aria-label="练习导航">
        <div className="qnav-card">
          <div className="qnav-head"><span>题号导航</span><span className="qnav-count">{visibleQuestions.length} 题</span></div>
          <div className="qnav-legend">
            {submitted ? <><span><i className="lg correct"/>正确</span><span><i className="lg wrong"/>错误</span></> : <><span><i className="lg answered"/>已答</span><span><i className="lg"/>未答</span></>}<span><i className="lg fav"/>收藏</span>
          </div>
          <div className="qnav">{questionButtons}</div>
        </div>
      </aside>
      <div className="section-side-switch" role="group" aria-label="切换题型">
          {[-1, 1].map(delta => {
            const target = availableSections[currentSectionIndex + delta]
            const label = target ? `${delta < 0 ? '上一部分' : '下一部分'}：${tabLabel(target)}` : (delta < 0 ? '没有上一部分' : '没有下一部分')
            return <button key={delta} className={delta < 0 ? 'previous' : 'next'} disabled={!target || busyNow} aria-label={label} title={label} onClick={() => target && goSection(target)}><Icon name="chevron" size={26}/></button>
          })}
      </div>
      <div className="practice-content">
      {submitted && result && <ResultHero result={result} exam={exam} paper={paperRow(paper.paper_key)} fullMode={fullMode}/>}
      <MarkableMaterial key={`${materialPaper}:${activeSection}`} paper={materialPaper} section={activeSection}>
      <div className="split">
        <div className="material">
          {kaoyan && (groupTabs.length > 0 || pdfs.length > 0) && <div className="ky-material-bar">
            {groupTabs.length > 0 && <KaoyanGroupSwitch section={activeSection} groups={groupTabs} current={currentGroup} disabled={busyNow} onSelect={selectGroup}/>}
            <KaoyanPdfLinks pdfs={pdfs}/>
          </div>}
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
            showReadingTranslation={readingTranslationOpen}
            readingTranslation={readingTranslation}
            kaoyan={kaoyan ? {
              questions: visibleQuestions, answers, currentQNo: focusedQuestion?.q_no, onFocus: focusNumber,
              bilingual: kaoyanBilingual, verdicts,
            } : undefined}
          />
        </div>
        <div className="questions-col">
          {!kaoyan && submitted && ['reading1', 'reading2'].includes(activeSection) && <div className="reading-translation-control card">
            <div><b>阅读模式 · {readingTranslationOpen ? '中英对照' : '仅原文'}</b><span className="hint">{readingTranslation.length ? '每个英文自然段下方显示对应中文' : '本篇译文暂不可用，可对照原解析 PDF'}</span></div>
            <button disabled={!readingTranslation.length} aria-pressed={readingTranslationOpen} aria-controls="reading-passage"
              onClick={() => setExpandedTranslation(readingTranslationOpen ? null : translationScope)}>
              <Icon name="text" size={16}/>{readingTranslationOpen ? '切换为仅原文' : '切换为中英对照'}
            </button>
          </div>}
          {kaoyanTranslation.length > 0 && <div className="reading-translation-control card">
            <div><b>阅读模式 · {kaoyanBilingual ? '中英对照' : '仅原文'}</b><span className="hint">每个英文自然段下方显示对应中文；段落译文整理自懒笔记，非官方</span></div>
            <button aria-pressed={kaoyanBilingual} aria-controls="kaoyan-passage"
              onClick={() => setExpandedTranslation(kaoyanBilingual ? null : translationScope)}>
              <Icon name="text" size={16}/>{kaoyanBilingual ? '切换为仅原文' : '切换为中英对照'}
            </button>
          </div>}
          {sectionPapers.length > 1 && <div className="redo-paper-switch">
            <label>当前试卷 <select aria-label="切换重做试卷" value={materialPaper} disabled={busyNow}
              onChange={e => focusQuestion(secQuestions.find((q: any) => q.paper_key === e.target.value))}>
              {sectionPapers.map(key => <option key={key} value={key}>{kaoyan ? paperShort(paperRow(key)) : key}（{secQuestions.filter((q: any) => q.paper_key === key).length} 题）</option>)}
            </select></label>
            <span className="muted small">题目与左侧材料按试卷一起切换。</span>
          </div>}
          {cardQuestions.map((q: any, index: number) => {
            const group = activeSection === 'listening' ? (mat?.content?.groups || []).find((g: any) => g.key === q.group_key || (q.q_no >= g.from && q.q_no <= g.to)) : null
            const previous = cardQuestions[index - 1]
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
                kaoyanMaterial={kaoyan ? pickMaterial(ownSections[q.section], q.group_key, exam) : undefined}
              />
              </Fragment>
            )
          })}

          {!kaoyan && activeSection === 'cloze' && wordBank.length === 0 && (
            <div className="card muted">本套选词填空词库缺失（待核对）。</div>
          )}
        </div>
      </div>
      </MarkableMaterial>
      </div>
    </div>
  )
}

/** One Part B layout shared by every matching question of the session, for the tab label (新题型 · 排序). */
function sharedVariant(questions: any[] = []): string | null {
  const variants = new Set(questions.map(q => q.variant).filter(Boolean))
  return variants.size === 1 ? [...variants][0] : null
}

function ResultHero({ result, exam, paper, fullMode }: { result: any; exam: Exam; paper: any; fullMode: boolean }) {
  const kaoyan = exam === 'kaoyan'
  const graded = (result.correct || 0) + (result.wrong || 0)
  const pct = result.accuracy != null ? result.accuracy * 100 : null
  const R = 52, C = 2 * Math.PI * R
  // Kaoyan results may carry the old CET labels; both read in exam order. CET keeps the stored order.
  const perSection = Object.entries(result.per_section || {})
  if (kaoyan) perSection.sort(([a], [b]) => resultSectionRank(a, exam) - resultSectionRank(b, exam))
  const year = Number(typeof paper === 'object' ? paper?.year : 0)
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
        {kaoyan
          ? <p className="muted">客观题正确率 = 正确 {result.correct} / 已作答且有参考答案 {graded}（参考答案非官方）</p>
          : <p className="muted">客观题正确率 = 正确 {result.correct} / 已作答且有答案 {graded}（不是四六级考试分数）</p>}
        <div className="result-stats">
          <div className="rs correct"><b>{result.correct}</b><span>正确</span></div>
          <div className="rs wrong"><b>{result.wrong}</b><span>错误</span></div>
          <div className="rs"><b>{result.unanswered}</b><span>未作答</span></div>
          <div className="rs"><b>{result.no_key}</b><span>无答案不判分</span></div>
        </div>
        {kaoyan && result.score && typeof result.score === 'object' && <KaoyanScore score={result.score}/>}
        {kaoyan && !result.score && (!fullMode || (year > 0 && year < 2005)) && <p className="muted small">
          {fullMode ? '1998–2004 年试卷结构与现行考试不同，只显示正确率，不计参考分。' : '错题重做只统计正确率，不计参考分。'}</p>}
        {result.note && <p className="muted small">{result.note}</p>}
      </div>
      <div className="result-sections">
        {perSection.map(([k, v]: any) => {
          const total = (v.correct || 0) + (v.wrong || 0) + (v.unanswered || 0) + (v.no_key || 0)
          const w = (n: number) => `${total ? (n / total) * 100 : 0}%`
          return (
            <div key={k} className="rsec">
              <div className="rsec-head"><span>{resultSectionLabel(k, exam)}</span><span>对 {v.correct} · 错 {v.wrong} · 未答 {v.unanswered}{v.no_key ? ` · 无答案 ${v.no_key}` : ''}</span></div>
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
