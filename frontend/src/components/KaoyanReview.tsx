import Icon from './Icon'
import KaoyanMaterial from './KaoyanMaterial'
import { KaoyanAnalysis, KaoyanQuestionBody } from './KaoyanQuestion'
import { groupLabel } from '../exam'
import '../kaoyan.css'

const noop = () => {}

/** Question detail (wrong book, favorites) for a kaoyan question: its own group's material with the question's
 *  place marked, the reference answer, evidence and references. GET /api/questions/{uid} without a session
 *  returns the whole section, so only the material whose group_key matches is read. */
export default function KaoyanReview({ q, mat }: { q: any; mat: any }) {
  const markBase = 1000 + (Number(q.q_no) || 0) * 100
  const groups = Array.isArray(q.materials) ? q.materials.length : 1
  const group = groupLabel(q.section, q.group_key, groups)
  const answers = q.has_answer && q.qtype === 'mcq' ? { [q.uid]: q.answer } : {}
  return <div className="modal-columns">
    <div className="modal-material">
      <KaoyanMaterial section={q.section} mat={mat} questions={[q]} answers={answers} currentQNo={q.q_no}/>
    </div>
    <div className="modal-question">
      <div className="qcard">
        <div className="qhead"><span className="qno">{q.q_no}</span><span className="tag">{q.section_cn}</span>{group && <span className="muted small">{group}</span>}</div>
        <KaoyanQuestionBody q={q} answer={answers[q.uid]} material={mat} displayAnswer={q.has_answer && q.qtype === 'mcq' ? q.answer : null}
          submitted={false} saving={false} markBase={markBase} review onChoose={noop} onKeyChoose={noop} onDraft={noop}/>
        <div className="analysis"><KaoyanAnalysis q={q} submitted={false} markBase={markBase} material={mat}/></div>
      </div>
      {q.note && <div className="analysis note-view"><div className="analysis-title"><Icon name="note" size={15}/>我的笔记</div><div className="analysis-text">{q.note}</div></div>}
    </div>
  </div>
}
