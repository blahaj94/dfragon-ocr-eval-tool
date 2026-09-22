import { useState } from 'react'
import { EvaluationWorkspace } from '../sections/EvaluationWorkspace'
import { DatasetWorkspace } from '../sections/DatasetWorkspace'
import dragonIcon from '../../../../resources/icon.png'

export function EvaluationPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'evaluation' | 'dataset'>('evaluation')
  const [datasetOpened, setDatasetOpened] = useState(false)

  function activateTab(tab: 'evaluation' | 'dataset'): void {
    setActiveTab(tab)
    if (tab === 'dataset') {
      setDatasetOpened(true)
    }
  }

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
          <h2>
            {activeTab === 'evaluation'
              ? '실제 이미지로, 정확하게.'
              : '캡처 데이터를 나누고, 확정하세요.'}
          </h2>
          <p>
            {activeTab === 'evaluation'
              ? '학습 체크포인트와 캡처 데이터를 선택해 OCR 결과를 확인합니다.'
              : '같은 캡처의 이미지를 함께 배정하고, 검사 후 학습용 데이터를 내보냅니다.'}
          </p>
        </div>
        <div className="workspace-tabs" role="tablist" aria-label="작업 선택">
          <button
            id="evaluation-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'evaluation'}
            aria-controls="evaluation-panel"
            tabIndex={activeTab === 'evaluation' ? 0 : -1}
            onClick={() => activateTab('evaluation')}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'End') {
                event.preventDefault()
                activateTab('dataset')
                document.getElementById('dataset-tab')?.focus()
              }
            }}
          >
            평가
          </button>
          <button
            id="dataset-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'dataset'}
            aria-controls="dataset-panel"
            tabIndex={activeTab === 'dataset' ? 0 : -1}
            onClick={() => activateTab('dataset')}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'Home') {
                event.preventDefault()
                activateTab('evaluation')
                document.getElementById('evaluation-tab')?.focus()
              }
            }}
          >
            Dataset
          </button>
        </div>
        <div
          id="evaluation-panel"
          role="tabpanel"
          aria-labelledby="evaluation-tab"
          hidden={activeTab !== 'evaluation'}
        >
          <EvaluationWorkspace />
        </div>
        <div
          id="dataset-panel"
          role="tabpanel"
          aria-labelledby="dataset-tab"
          hidden={activeTab !== 'dataset'}
        >
          {datasetOpened && <DatasetWorkspace />}
        </div>
      </main>
      <footer>
        REAL DATA. MEASURABLE RESULTS.<span>ldb-ocr evaluation · MVP</span>
      </footer>
    </div>
  )
}
