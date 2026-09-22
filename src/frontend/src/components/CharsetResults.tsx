import { useState } from 'react'
import type { CharacterKind, CharsetInspection } from '../../../shared/charset'

const kindLabels: Record<CharacterKind, string> = {
  korean: '한글',
  latin: '영문',
  digit: '숫자',
  han: '한자',
  hiragana: '히라가나',
  katakana: '가타카나',
  special: '특수문자',
  other: '기타'
}
const statusLabels: Record<CharsetInspection['status'], string> = {
  covered: '누락 없음',
  missing: '누락 문자 있음',
  empty: '검사 대상 없음'
}

export function CharsetResults({
  inspection
}: {
  inspection: CharsetInspection
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const characters = showAll
    ? inspection.characters
    : inspection.characters.filter((character) => !character.included)

  return (
    <>
      <section
        className={`panel charset-status charset-${inspection.status}`}
        aria-label="문자 검사 상태"
      >
        <div className="status-label" role="status">
          <span className="status-dot" />
          {statusLabels[inspection.status]}
        </div>
        <span>정답 {inspection.sampleCount.toLocaleString()}개 · 고유 문자 기준</span>
      </section>
      <section className="metrics-grid charset-metrics" aria-label="문자 포함 집계">
        <div className="metric-card">
          <span>고유 문자 수</span>
          <strong>{inspection.uniqueCount.toLocaleString()}</strong>
          <small>정답에서 발견한 서로 다른 문자</small>
        </div>
        <div className="metric-card">
          <span>포함 문자 수</span>
          <strong>{inspection.includedCount.toLocaleString()}</strong>
          <small>문자 사전에 포함된 고유 문자</small>
        </div>
        <div className="metric-card">
          <span>누락 문자 수</span>
          <strong>{inspection.missingCount.toLocaleString()}</strong>
          <small>문자 사전에 없는 고유 문자</small>
        </div>
        <div className="metric-card">
          <span>문자 포함률</span>
          <strong>
            {inspection.coverage == null ? '—' : `${(inspection.coverage * 100).toFixed(2)}%`}
          </strong>
          <small>포함 문자 수 / 고유 문자 수</small>
        </div>
      </section>
      <section className="panel charset-characters" aria-label="문자별 검사 결과">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CHARACTER COVERAGE</span>
            <h3>문자별 결과</h3>
          </div>
          <div className="filter-switch" aria-label="문자 결과 필터">
            <button
              type="button"
              aria-pressed={!showAll}
              aria-label={`누락 문자 ${inspection.missingCount.toLocaleString()}`}
              onClick={() => setShowAll(false)}
            >
              누락 문자 <span>{inspection.missingCount.toLocaleString()}</span>
            </button>
            <button
              type="button"
              aria-pressed={showAll}
              aria-label={`전체 문자 ${inspection.uniqueCount.toLocaleString()}`}
              onClick={() => setShowAll(true)}
            >
              전체 문자 <span>{inspection.uniqueCount.toLocaleString()}</span>
            </button>
          </div>
        </div>
        {characters.length === 0 ? (
          <div className="empty-state charset-empty">
            <span className="empty-symbol" aria-hidden="true">
              [ ∅ ]
            </span>
            <h4>
              {inspection.status === 'empty' ? '검사할 문자가 없습니다' : '누락된 문자가 없습니다'}
            </h4>
            <p>
              {inspection.status === 'empty'
                ? '정답 파일에서 검사할 문자를 찾지 못해 포함률을 계산하지 않았습니다.'
                : '전체 문자에서 각 문자의 포함 여부를 확인할 수 있습니다.'}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="charset-table">
              <thead>
                <tr>
                  <th scope="col">문자</th>
                  <th scope="col">코드 포인트</th>
                  <th scope="col">종류</th>
                  <th scope="col" className="numeric">
                    등장 횟수
                  </th>
                  <th scope="col">포함 여부</th>
                </tr>
              </thead>
              <tbody>
                {characters.map((character) => (
                  <tr key={character.character}>
                    <td>
                      <span className="charset-character" title={character.character}>
                        {character.displayName}
                      </span>
                    </td>
                    <td>
                      <code>{character.codePoint}</code>
                    </td>
                    <td>{kindLabels[character.kind]}</td>
                    <td className="numeric">{character.count.toLocaleString()}</td>
                    <td>
                      <span
                        className={
                          character.included ? 'charset-included' : 'charset-missing-label'
                        }
                      >
                        {character.included ? '포함' : '누락'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>공백·제어문자도 표시 이름과 코드 포인트로 구분합니다.</span>
          <span>공백 추가 설정: {inspection.useSpace ? '켜짐' : '꺼짐'}</span>
        </div>
      </section>
    </>
  )
}
