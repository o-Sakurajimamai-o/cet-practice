import { useRef, useState } from 'react'
import { api, backupImport } from '../api'
import { discardRestoredNoteDrafts, persistAllNoteDrafts, waitForNoteSaves } from '../noteDrafts'
import Icon from '../components/Icon'
import { examOf } from '../exam'

const BACKUP_TABLES = ['sessions', 'wrong_book', 'favorites', 'notes', 'text_marks', 'manual_fixes']
/** Records in a backup that belong to the 考研 board: sessions and marks name their paper, the other rows a question uid. */
function kaoyanRecords(data: any): number {
  return BACKUP_TABLES.reduce((n, table) => n + (Array.isArray(data?.[table]) ? data[table].filter((row: any) => row && typeof row === 'object' && examOf(row) === 'kaoyan').length : 0), 0)
}

export default function Backup() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [result, setResult] = useState<any | null>(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [fileName, setFileName] = useState('')
  const busyRef = useRef(false)
  const [exporting, setExporting] = useState(false)
  async function doExport() {
    if (exporting || busyRef.current) return
    setExporting(true)
    setErr('')
    try {
      await persistAllNoteDrafts()
      const data = await api('/api/backup/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `cet6-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e: any) { setErr('备份导出失败：' + String(e.message || e)) }
    finally { setExporting(false) }
  }
  async function doImport(confirmed = false) {
    if (busyRef.current || exporting) return
    const f = fileRef.current?.files?.[0]
    if (!f) { setErr('请先选择备份 JSON 文件'); return }
    if (mode === 'replace' && !confirmed) { setConfirming(true); return }
    busyRef.current = true
    setErr(''); setResult(null); setBusy(true); setConfirming(false)
    let kaoyan = 0
    try {
      const data = JSON.parse(await f.text())
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== 'cet6-backup') throw new Error('请选择英语研习室（含原四六级研习室）导出的备份文件（缺少 cet6-backup 标识）。')
      kaoyan = kaoyanRecords(data)
      await waitForNoteSaves()
      const restored = await backupImport(data, mode === 'merge')
      if (mode === 'replace') discardRestoredNoteDrafts()
      setResult(restored)
    } catch (e: any) {
      const msg = e instanceof SyntaxError ? '文件不是有效的 JSON，请选择导出的备份文件。' : String(e.message || e)
      // The server rejects the whole file when a paper or question is missing; with 考研 rows the usual cause is a bank without 考研 papers.
      setErr(kaoyan && /试卷尚未导入|题库中不存在/.test(msg) ? `${msg}。这份备份含 ${kaoyan} 条考研记录，请先导入考研题库再恢复。` : msg)
    }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <div className="backup-page">
    <header className="page-heading"><span className="eyebrow"><Icon name="backup" size={14}/>Keep your progress</span><h1>备份与恢复</h1><p>让每一份练习都有留存。定期导出学习记录，换设备或恢复时也能从容继续。</p></header>
    <div className="backup-grid">
      <section className="card backup-card">
        <div className="feature-icon indigo"><Icon name="download" size={24}/></div>
        <h2>导出学习记录</h2>
        <p>将此设备上四级、六级与考研的个人学习数据保存为 JSON 文件，建议另存一份到其他磁盘。</p>
        <div className="backup-list">{['作答与草稿', '练习进度', '交卷结果', '错题与收藏', '学习笔记', '文章标记', '人工校正'].map(t => <span key={t}><Icon name="check" size={13}/>{t}</span>)}</div>
        <button className="primary big" disabled={exporting || busy} onClick={doExport}><Icon name="download" size={17}/>{exporting ? '正在导出…' : '下载备份文件'}</button>
        <div className="backup-hint">导出文件只含个人记录（包括考研练习），不含题库本体：四六级题库由源 PDF 导入，考研题库由懒笔记存档导入。</div>
      </section>
      <section className="card backup-card">
        <div className="feature-icon violet"><Icon name="upload" size={24}/></div>
        <h2>恢复学习记录</h2>
        <p>选择之前导出的备份文件。合并模式会保留现有练习，并补充尚未存在的记录。</p>
        <label className={`upload-field${fileName ? ' has-file' : ''}`}><Icon name={fileName ? 'file' : 'upload'} size={22}/><span>{fileName || '点击选择备份文件'}<small>{fileName ? '点击可重新选择' : '支持英语研习室（含原四六级研习室）导出的 JSON 文件'}</small></span><input className="visually-hidden" aria-label="选择备份文件" type="file" accept=".json,application/json" ref={fileRef} disabled={busy} onChange={() => { setFileName(fileRef.current?.files?.[0]?.name || ''); setResult(null); setErr(''); setConfirming(false) }}/></label>
        <div className="mode-picker" role="radiogroup" aria-label="恢复模式">
          {([['merge', '合并记录', '推荐 · 保留现有练习'], ['replace', '替换学习记录', '保留题目校正']] as const).map(([v, t, d]) => (
            <label key={v} className={`mode-option${mode === v ? ' active' : ''}`}>
              <input type="radio" name="restore-mode" value={v} checked={mode === v} disabled={busy} onChange={() => { setMode(v); setConfirming(false); setResult(null); setErr('') }}/>
              <span><b>{t}</b><small>{d}</small></span>
            </label>
          ))}
        </div>
        <button className="primary big" disabled={busy || exporting} onClick={() => doImport()}><Icon name="upload" size={17}/>{busy ? '正在恢复…' : '导入备份'}</button>
        <p className="backup-hint">合并时，笔记按更新时间保留较新内容；来源不同但编号相同的练习会另建记录，重复导入同一份备份不会重复创建。替换时，备份未覆盖的题目校正仍会保留，避免把已修正的答案还原。</p>
        <p className="backup-hint">备份涉及的试卷必须已在本机题库中：含考研记录的备份，需要先导入考研题库；缺少任何一套试卷时整份备份都不会导入，现有数据保持不变。</p>
      </section>
    </div>
    {confirming && <div className="notice error confirm-notice" role="alert"><div><b>确认用「{fileName}」替换学习记录？</b><div>当前的作答、错题、收藏、笔记和文章标记将被备份中的记录替换。备份未覆盖的题目校正会保留，避免把已修正的答案还原。建议先下载一份当前备份。</div></div><div className="notice-actions"><button className="danger" disabled={busy || exporting} onClick={() => doImport(true)}>确认替换</button><button disabled={busy} onClick={() => setConfirming(false)}>取消</button></div></div>}
    {err && <div className="notice error" role="alert"><span><Icon name="alert" size={16}/>{err}</span></div>}
    {result?.imported && <div className="card restore-result" role="status"><h3><Icon name="check" size={20}/>记录已恢复</h3><div className="result-stats">{Object.entries({sessions:'新增会话',wrong_book:'错题',favorites:'收藏',notes:'笔记',text_marks:'文章标记',manual_fixes:'人工校正'}).map(([k,v]) => <div className="rs" key={k}><b>{result.imported[k]}</b><span>{v}</span></div>)}</div>{result.retained_manual_fixes > 0 && <p className="muted small">另保留了本地 {result.retained_manual_fixes} 条题目校正。</p>}<p className="muted small">可以在「复习空间 → 练习历史」核对恢复结果。</p></div>}
  </div>
}
