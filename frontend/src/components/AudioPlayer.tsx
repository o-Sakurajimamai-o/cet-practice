import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon'

export type ListeningCue = { number: number; from: number; to: number; start: number; estimated?: boolean }
export type ListeningCueSet = { duration: number; cues: ListeningCue[] }

/** 听力播放器：播放/暂停/继续、拖动进度、音量、倍速；位置由外部恢复与保存。 */
export default function AudioPlayer({
  src, startPos, onPos, hasAudio, paused = false, cueSet, noAudioEdition = false,
}: {
  src: string | null
  startPos: number
  onPos: (pos: number, updateUi?: boolean) => void
  hasAudio: boolean
  paused?: boolean
  cueSet?: ListeningCueSet
  noAudioEdition?: boolean
}) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [rate, setRate] = useState(1)
  const restored = useRef(false)
  const restorePosition = useRef(startPos)
  const onPosRef = useRef(onPos)
  onPosRef.current = onPos
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    const a = ref.current
    if (!a) return
    restored.current = false
    restorePosition.current = startPos
    setCur(0)
    setDur(0)
    setPlaying(false)
    setError('')
    const report = () => {
      if (restored.current && Number.isFinite(a.currentTime)) onPosRef.current(a.currentTime, false)
    }
    // Publish before the parent's leave-page beacon, including when metadata is
    // loaded and the user changes sections between the five-second saves.
    window.addEventListener('beforeunload', report, true)
    window.addEventListener('pagehide', report, true)
    document.addEventListener('visibilitychange', report, true)
    return () => {
      report()
      a.pause()
      window.removeEventListener('beforeunload', report, true)
      window.removeEventListener('pagehide', report, true)
      document.removeEventListener('visibilitychange', report, true)
    }
  }, [src])

  useEffect(() => { if (paused) ref.current?.pause() }, [paused])

  useEffect(() => {
    const id = setInterval(() => {
      const a = ref.current
      if (a && !a.paused) onPosRef.current(a.currentTime)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  if (!hasAudio || !src) {
    return (
      <div className="audio-bar no-audio-bar">
        <span className="no-audio"><Icon name="alert" size={17}/>{noAudioEdition ? '当前为无听力音频版，题目、录音原文和解析仍可使用。需要播放时请下载附听力版。' : '本套次缺少听力音频文件，无法播放（听力题仍可练习）'}</span>
      </div>
    )
  }

  async function toggle() {
    const a = ref.current
    if (!a || paused) return
    try {
      if (a.paused) {
        if (a.error) { restorePosition.current = cur || startPos; restored.current = false; a.load() }
        await a.play()
        setError('')
      } else { a.pause(); onPos(a.currentTime) }
    } catch { setError('音频暂时无法播放，请检查文件是否存在，或重试播放。') }
  }

  function fmt(s: number) {
    if (!isFinite(s)) return '--:--'
    const m = Math.floor(s / 60), ss = Math.floor(s % 60)
    return `${m}:${String(ss).padStart(2, '0')}`
  }
  const visibleCues = cueSet && dur > 0 && Math.abs(cueSet.duration - dur) < 1
    ? cueSet.cues.filter(cue => Number.isFinite(cue.start) && cue.start >= 0 && cue.start < dur)
    : []

  return (
    <div className="audio-bar">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onError={() => setError('音频加载失败，请检查本地音频文件。')}
        onPlay={() => setPlaying(true)}
        onPause={e => { setPlaying(false); if (restored.current) onPosRef.current(e.currentTarget.currentTime) }}
        onTimeUpdate={e => {
          setCur(e.currentTarget.currentTime)
          if (restored.current) onPosRef.current(e.currentTarget.currentTime, false)
        }}
        onLoadedMetadata={() => {
          const a = ref.current!
          setDur(Number.isFinite(a.duration) ? a.duration : 0)
          a.volume = vol
          a.playbackRate = rate
          if (!restored.current && Number.isFinite(a.duration)) {
            a.currentTime = Math.max(0, Math.min(restorePosition.current, a.duration))
            restored.current = true
            setCur(a.currentTime)
            onPosRef.current(a.currentTime)
          }
        }}
        onEnded={e => { setPlaying(false); onPosRef.current(e.currentTarget.currentTime) }}
      />
      <button className={`play${playing ? ' playing' : ''}`} disabled={paused} onClick={toggle} aria-label={playing ? '暂停' : '播放'}><Icon name={playing ? 'pause' : 'play'} size={18}/></button>
      <div className="audio-main">
        <div className="audio-caption"><span><Icon name="headphones" size={15}/>听力音频{visibleCues.length > 0 && <small className="audio-cue-hint">点击水滴跳转篇目</small>}</span><span className="audio-time">{fmt(cur)} <i>/</i> {fmt(dur)}</span></div>
        <div className={`audio-progress-track${visibleCues.length ? ' has-cues' : ''}`}>
          <input
            className="audio-progress"
            aria-label="听力播放进度"
            type="range" min={0} max={dur || 0} step={0.5} value={cur}
            disabled={paused || !dur}
            style={{ '--fill': `${dur ? (cur / dur) * 100 : 0}%` } as React.CSSProperties}
            onChange={(e) => {
              const v = Number(e.target.value)
              setCur(v)
              if (ref.current) ref.current.currentTime = v
              onPos(v)
            }}
          />
          {visibleCues.map((cue, index) => {
            const label = `篇目 ${cue.number} · 第 ${cue.from}–${cue.to} 题 · ${cue.estimated ? '约 ' : ''}${fmt(cue.start)}${cue.estimated ? '（语音识别估计，可能有少量偏差）' : ''}`
            // Keep neighboring hit areas disjoint even when markers are close together on a phone.
            const gap = Math.min(cue.start - (visibleCues[index - 1]?.start ?? cue.start - dur),
              (visibleCues[index + 1]?.start ?? cue.start + dur) - cue.start)
            return <button key={`${cue.from}-${cue.to}`} type="button" className="audio-cue"
              style={{ left: `calc(${100 * cue.start / dur}% + ${8 - 16 * cue.start / dur}px)`,
                width: `min(30px, calc(${100 * gap / dur}% - ${16 * gap / dur}px))` }}
              title={label} aria-label={`跳转到${label}`} disabled={paused}
              onClick={() => {
                if (!ref.current) return
                ref.current.currentTime = cue.start
                setCur(cue.start)
                onPos(cue.start)
              }}><svg viewBox="0 0 18 20" aria-hidden="true" focusable="false"><path d="M9 1.5C7.7 4.6 3 7.6 3 12a6 6 0 0 0 12 0c0-4.4-4.7-7.4-6-10.5Z"/></svg></button>
          })}
        </div>
      </div>
      <label className="audio-volume" title="音量"><Icon name="volume" size={17}/><span className="visually-hidden">音量</span><input type="range" min={0} max={1} step={0.05} value={vol}
        style={{ '--fill': `${vol * 100}%` } as React.CSSProperties}
        onChange={(e) => { const v = Number(e.target.value); setVol(v); if (ref.current) ref.current.volume = v }} /></label>
      <label className="audio-rate" title="倍速"><span className="visually-hidden">倍速</span>
        <select value={rate} onChange={(e) => {
          const v = Number(e.target.value); setRate(v)
          if (ref.current) ref.current.playbackRate = v
        }}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
      </label>
      {error && <div className="audio-error" role="alert">{error}</div>}
    </div>
  )
}
