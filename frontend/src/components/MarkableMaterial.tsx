import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'

type Mark = { id: string; paper_key: string; section: string; passage_index: number; start_offset: number; end_offset: number; text: string; created_at: string }

// Ignore interactive blank slots: their labels change as answers are selected.
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const button = node.parentElement?.closest('button')
    const skipped = node.parentElement?.closest('[data-mark-skip]')
    // Inline translations have their own anchors; legacy English offsets stay unchanged.
    if (skipped && root !== skipped && root.contains(skipped)) continue
    if (!button || !root.contains(button)) nodes.push(node as Text)
  }
  return nodes
}
function textOffset(root: HTMLElement, target: Node, offset: number): number | null {
  if (!root.contains(target)) return null
  const prefix = new Range()
  prefix.selectNodeContents(root)
  prefix.setEnd(target, offset)
  let total = 0
  for (const node of textNodes(root)) {
    if (node === target) return total + offset
    if (prefix.comparePoint(node, node.data.length) === 0) total += node.data.length
  }
  return total
}

// Use the same ranges for painting and hit testing, including legacy offsets and nested translations.
function rangesForMark(root: HTMLElement, mark: Mark): Range[] {
  const passages = root.querySelectorAll<HTMLElement>('.passage')
  const el = mark.passage_index < 10 ? passages[mark.passage_index]
    : root.querySelector<HTMLElement>(`[data-mark-index="${mark.passage_index}"]`)
  if (!el) return []
  const nodes = textNodes(el), text = nodes.map(node => node.data).join('')
  let start = mark.start_offset
  if (text.slice(start, mark.end_offset) !== mark.text) {
    const first = text.indexOf(mark.text)
    if (first < 0 || text.indexOf(mark.text, first + 1) >= 0) return []
    start = first
  }
  const ranges: Range[] = []
  let offset = 0
  for (const node of nodes) {
    const from = Math.max(0, start - offset)
    const to = Math.min(node.length, start + mark.text.length - offset)
    if (to > from) {
      const range = new Range(); range.setStart(node, from); range.setEnd(node, to); ranges.push(range)
    }
    offset += node.length
    if (offset >= start + mark.text.length) break
  }
  return ranges
}

export default function MarkableMaterial({ paper, section, children }: { paper: string; section: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [marks, setMarks] = useState<Mark[]>([])
  const [pending, setPending] = useState<Mark | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [popup, setPopup] = useState<{x: number; y: number} | null>(null)
  const [markPopup, setMarkPopup] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  const supported = typeof CSS !== 'undefined' && 'highlights' in CSS && 'Highlight' in window
  useEffect(() => {
    const dismissSelection = () => { setPending(null); setPopup(null) }
    const dismiss = () => { dismissSelection(); setMarkPopup(null) }
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount
        || !ref.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) dismissSelection()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-save-mark], [data-mark-control]')) return
      dismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])
  useEffect(() => {
    let alive = true
    setMarks([]); setPending(null); setPopup(null); setMarkPopup(null); setError('')
    api(`/api/marks?paper_key=${encodeURIComponent(paper)}&section=${encodeURIComponent(section)}`)
      .then(d => { if (alive) setMarks(d.marks) })
      .catch(() => { if (alive) setError('标记加载失败，请刷新页面重试。') })
    return () => { alive = false }
  }, [paper, section])
  useLayoutEffect(() => {
    if (!supported || !ref.current) return
    const root = ref.current
    const registry = (CSS as any).highlights
    const refresh = () => {
      const ranges = marks.flatMap(mark => rangesForMark(root, mark))
      registry.set('practice-marks', new (window as any).Highlight(...ranges))
    }
    refresh()
    // Explanations and their selectable text mount only when the user opens them.
    const observer = new MutationObserver(refresh)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect(); registry.delete('practice-marks') }
  }, [marks, supported])
  function capture() {
    const selection = window.getSelection(), root = ref.current
    if (!selection || selection.isCollapsed || !root || !selection.rangeCount) { setPending(null); setPopup(null); return }
    const originalRange = selection.getRangeAt(0)
    const passages = Array.from(root.querySelectorAll<HTMLElement>('.passage'))
    const explicitTargets = Array.from(root.querySelectorAll<HTMLElement>('[data-mark-index]'))
    // Mouse drags may start on the edge of an option and include only surrounding whitespace.
    const matches = explicitTargets.filter(el => originalRange.intersectsNode(el))
    // Kaoyan nests targets (a reading text 100+n holds its Chinese paragraphs), so the innermost one wins;
    // document order puts it last. CET has no nested targets, so its choice is unchanged.
    const explicit = [...matches].reverse().find(el => el.contains(originalRange.startContainer) && el.contains(originalRange.endContainer))
      || (matches.length === 1 ? matches[0] : undefined)
    const passageIndex = passages.findIndex(el => el.contains(originalRange.startContainer) && el.contains(originalRange.endContainer))
    const target = explicit || passages[passageIndex]
    const index = explicit ? Number(explicit.dataset.markIndex) : passageIndex
    if (!target || index < 0) { setPending(null); setPopup(null); return }
    const range = originalRange.cloneRange()
    if (!target.contains(range.startContainer)) range.setStart(target, 0)
    if (!target.contains(range.endContainer)) range.setEnd(target, target.childNodes.length)
    if (range.toString().trim() !== originalRange.toString().trim()) { setPending(null); setPopup(null); return }
    // Do not persist a selection that spans a changing fill-in blank.
    if (Array.from(target.querySelectorAll('button')).some(button => range.intersectsNode(button))) {
      setPending(null); setPopup(null); setError('请避开空位按钮，选择单词或短句。'); return
    }
    const start = textOffset(target, range.startContainer, range.startOffset)
    const end = textOffset(target, range.endContainer, range.endOffset)
    const text = range.toString()
    if (start === null || end === null || !text.trim() || text.length > 500) { setPending(null); setPopup(null); return }
    setError('')
    setPending({ id: crypto.randomUUID(), paper_key: paper, section, passage_index: index, start_offset: start, end_offset: end, text, created_at: new Date().toISOString() })
    const rect = range.getBoundingClientRect()
    setPopup({ x: Math.max(58, Math.min(window.innerWidth - 58, (rect.left + rect.right) / 2)), y: Math.max(8, rect.top - 44) })
  }
  async function save() {
    if (!pending || busy) return
    setBusy(true); setError('')
    try { const added = await api('/api/marks', { method: 'POST', body: JSON.stringify(pending) }); setMarks(m => [...m, added]); setPending(null); setPopup(null); window.getSelection()?.removeAllRanges() }
    catch { setError('标记保存失败，请重试。') }
    finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (deletingId) return
    setDeletingId(id); setError('')
    try {
      await api(`/api/marks/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setMarks(m => m.filter(x => x.id !== id))
      setMarkPopup(current => {
        if (!current) return null
        const ids = current.ids.filter(value => value !== id)
        return ids.length ? { ...current, ids } : null
      })
    }
    catch { setError('删除失败，请重试。') }
    finally { setDeletingId(null) }
  }
  function openMarkedText(event: React.MouseEvent<HTMLDivElement>) {
    const root = ref.current, target = event.target
    if (!supported || !root || event.button !== 0 || !window.getSelection()?.isCollapsed
      || (target instanceof Element && target.closest('[data-mark-control], [data-save-mark], .mark-tools'))) return
    const ids = marks.filter(mark => rangesForMark(root, mark).some(range =>
      Array.from(range.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom))).map(mark => mark.id)
    if (!ids.length) return
    // An option may itself be a button: opening its mark must not change the answer.
    event.preventDefault(); event.stopPropagation()
    setPending(null); setPopup(null); setError('')
    const halfWidth = Math.min(180, Math.max(0, window.innerWidth / 2 - 12))
    setMarkPopup({ ids, x: Math.min(window.innerWidth - halfWidth - 12, Math.max(halfWidth + 12, event.clientX)), y: Math.max(12, Math.min(window.innerHeight - 120, event.clientY + 10)) })
  }
  return <div ref={ref} onMouseUp={capture} onClickCapture={openMarkedText}>
    <div className="mark-tools"><span>选中文本后标记；点击高亮可取消标记</span><button data-save-mark disabled={!pending || busy} onMouseDown={e => e.preventDefault()} onClick={save}>标记选中内容</button>
      {marks.length > 0 && <details><summary>已标记 {marks.length}</summary><ul>{marks.map(m => <li key={m.id}><span>{m.text}</span><button disabled={!!deletingId} aria-label={`删除标记 ${m.text}`} onClick={() => remove(m.id)}>取消标记</button></li>)}</ul></details>}
      {!supported && <span>当前浏览器不支持文章内高亮，已保存内容可在标记列表中查看。</span>}
      {error && <span role="alert">{error}</span>}
    </div>
    {pending && popup && <button className="mark-popup" data-save-mark style={{ left: popup.x, top: popup.y }} disabled={busy} onMouseDown={e => e.preventDefault()} onClick={save}>标记选中内容</button>}
    {markPopup && <div className="mark-remove-popup" data-mark-control role="group" aria-label="取消标记" style={{ left: markPopup.x, top: markPopup.y }}>
      {marks.filter(m => markPopup.ids.includes(m.id)).map(m => <div className="mark-remove-row" key={m.id}>
        <span title={m.text}>{m.text}</span><button disabled={!!deletingId} aria-label={`取消标记 ${m.text}`} onClick={() => remove(m.id)}>{deletingId === m.id ? '取消中…' : '取消标记'}</button>
      </div>)}
      {error && <span role="alert">{error}</span>}
    </div>}
    {children}
  </div>
}
