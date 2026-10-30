import { textLines } from '../kaoyan'

/** Reflow PDF line endings at display time. Source text and genuine blank paragraphs stay intact. */
export function joinPdfLines(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  return lines.reduce((result, line) => {
    if (!result) return line
    const cjk = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/
    const previous = result.slice(-1), next = line[0]
    const join = previous === '-' || (cjk.test(previous) && cjk.test(next))
    return result + (join ? '' : ' ') + line
  }, '').replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
}

export default function PdfProse({ text, className = '' }: { text?: string; className?: string }) {
  return <div className={`pdf-prose ${className}`}>{(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).filter(block => block.trim()).map((block, i) => <p key={i}>{joinPdfLines(block)}</p>)}</div>
}

/** Kaoyan essays and reference translations: every non-empty line is its own paragraph. Unlike PdfProse it never
 *  joins lines, so a letter keeps its salutation and sign-off and two paragraphs never run together (CONTRACT §6.4). */
export function LineProse({ text, className = '' }: { text?: string | null; className?: string }) {
  return <div className={`line-prose ${className}`}>{textLines(text).map((line, i) => <p key={i}>{line}</p>)}</div>
}

export function SubjectivePrompt({ text, section }: { text?: string; section: string }) {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n')
  const source = /^\s*真题卷/.test(lines[0] || '') ? lines.shift() : ''
  // Translation instructions and the Chinese source are distinct reading blocks.
  const bodyStart = section === 'translation' ? lines.findIndex(line => /^[\s“「（]*[\u3400-\u9fff]/.test(line)) : -1
  return <div className={`subjective-prompt ${section}`}>
    {source && <div className="prompt-source">{source}</div>}
    {bodyStart > 0 ? <><PdfProse text={lines.slice(0, bodyStart).join('\n')} className="prompt-instructions"/><PdfProse text={lines.slice(bodyStart).join('\n')} className="prompt-body"/></> : <PdfProse text={lines.join('\n')}/>}
  </div>
}
