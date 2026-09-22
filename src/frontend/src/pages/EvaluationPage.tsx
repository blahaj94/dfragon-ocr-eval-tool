import { EvaluationWorkspace } from '../sections/EvaluationWorkspace'
import dragonIcon from '../../../../resources/icon.png'

export function EvaluationPage(): React.JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-header">
        <img className="brand-mark" src={dragonIcon} alt="DFragon 빨간 용 아이콘" />
        <div className="brand-copy">
          <span className="eyebrow">DFRAGON / MODEL EVALUATION</span>
          <h1>Real OCR Evaluation</h1>
        </div>
        <span className="environment-badge">
          <span />
          LOCAL · WINDOWS GPU
        </span>
      </header>
      <main>
        <div className="intro">
          <h2>실제 이미지로, 정확하게.</h2>
          <p>학습 체크포인트와 캡처 데이터를 선택해 OCR 결과를 확인합니다.</p>
        </div>
        <EvaluationWorkspace />
      </main>
      <footer>
        REAL DATA. MEASURABLE RESULTS.<span>ldb-ocr evaluation · MVP</span>
      </footer>
    </div>
  )
}
