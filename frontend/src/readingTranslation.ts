export type ReadingTranslationParagraph = { number: number; text: string; sourceEnglish: string }

/** The saved PDF extract contains a preface and question analysis around P1…Pn. */
export function parseReadingTranslation(raw?: string): ReadingTranslationParagraph[] {
  if (!raw) return []
  const body = raw.replace(/\r\n?/g, '\n').split(/题目\s*与\s*逐题解析/)[0]
  const anchors = [...body.matchAll(/^P(\d+)\s+(?=[A-Za-z“‘"\d(])/gm)]
  if (!anchors.length || anchors.some((anchor, i) => Number(anchor[1]) !== i + 1)) return []
  const paragraphs: ReadingTranslationParagraph[] = []
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]
    const block = body.slice(anchor.index! + anchor[0].length, anchors[i + 1]?.index ?? body.length)
      .replace(/\bQuestions\s+\d+\s+(?:to|and)\s+\d+\s+are\s+based\s+on\s+the\s+following\s+passage\.?/gi, '')
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    const start = lines.findIndex(line => {
      // A Chinese vocabulary gloss can wrap onto the next English line.
      if (/^[\u3400-\u9fff\s]+[)）]/.test(line)) return false
      const withoutGloss = line.replace(/[（(][^()（）]*[）)]/g, '')
      const chinese = withoutGloss.match(/[\u3400-\u9fff]/g)?.length || 0
      // Most translations start in Chinese; names such as NASA may precede it.
      return /^[\s“"「『（(]*[\u3400-\u9fff]/.test(line)
        || chinese / Math.max(1, withoutGloss.replace(/\s/g, '').length) > 0.2
    })
    if (start < 0) return []
    paragraphs.push({ number: Number(anchor[1]), text: lines.slice(start).join('\n'), sourceEnglish: lines.slice(0, start).join('\n') })
  }
  return paragraphs
}
