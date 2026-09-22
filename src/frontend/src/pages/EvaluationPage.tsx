import { useState } from 'react'
import { EvaluationWorkspace } from '../sections/EvaluationWorkspace'
import { DatasetWorkspace } from '../sections/DatasetWorkspace'
import { ComparisonWorkspace } from '../sections/ComparisonWorkspace'
import { CharsetWorkspace } from '../sections/CharsetWorkspace'
import dragonIcon from '../../../../resources/icon.png'

const tabs = [
  {
    id: 'evaluation',
    label: '평가',
    title: '실제 이미지로, 정확하게.',
    description: '학습 체크포인트와 캡처 데이터를 선택해 OCR 결과를 확인합니다.'
  },
  {
    id: 'dataset',
    label: 'Dataset',
    title: '캡처 데이터를 나누고, 확정하세요.',
    description: '같은 캡처의 이미지를 함께 배정하고, 검사 후 학습용 데이터를 내보냅니다.'
  },
  {
    id: 'comparison',
    label: '결과 비교',
    title: '두 평가 결과의 차이를 확인하세요.',
    description: '저장된 보고서의 지표와 샘플별 예측을 나란히 비교합니다.'
  },
  {
    id: 'charset',
    label: '문자 검사',
    title: '정답에 쓰인 문자가 사전에 있는지 확인하세요.',
    description: '학습 결과의 문자 사전과 정답 파일을 읽어 누락된 문자를 확인합니다.'
  }
] as const

type WorkspaceTab = (typeof tabs)[number]['id']

export function EvaluationPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('evaluation')
  const [datasetOpened, setDatasetOpened] = useState(false)
  const [comparisonOpened, setComparisonOpened] = useState(false)
  const [charsetOpened, setCharsetOpened] = useState(false)
  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]

  function activateTab(tab: WorkspaceTab): void {
    setActiveTab(tab)
    if (tab === 'dataset') {
      setDatasetOpened(true)
    }
    if (tab === 'comparison') {
      setComparisonOpened(true)
    }
    if (tab === 'charset') {
      setCharsetOpened(true)
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
          <h2>{currentTab.title}</h2>
          <p>{currentTab.description}</p>
        </div>
        <div className="workspace-tabs" role="tablist" aria-label="작업 선택">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`${tab.id}-tab`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`${tab.id}-panel`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => activateTab(tab.id)}
              onKeyDown={(event) => {
                const nextIndex =
                  event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : null
                if (nextIndex != null) {
                  event.preventDefault()
                  const nextTab = tabs[nextIndex].id
                  activateTab(nextTab)
                  document.getElementById(`${nextTab}-tab`)?.focus()
                }
              }}
            >
              {tab.label}
            </button>
          ))}
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
        <div
          id="comparison-panel"
          role="tabpanel"
          aria-labelledby="comparison-tab"
          hidden={activeTab !== 'comparison'}
        >
          {comparisonOpened && <ComparisonWorkspace />}
        </div>
        <div
          id="charset-panel"
          role="tabpanel"
          aria-labelledby="charset-tab"
          hidden={activeTab !== 'charset'}
        >
          {charsetOpened && <CharsetWorkspace />}
        </div>
      </main>
      <footer>
        REAL DATA. MEASURABLE RESULTS.<span>ldb-ocr evaluation · MVP</span>
      </footer>
    </div>
  )
}
