import { useEffect, useState } from 'react'
import {
  CHARACTER_GROUPS,
  CHARACTER_GROUP_LABELS,
  type SupplementInfo,
  type SupplementOptions,
  type SupplementPreview
} from '../../../shared/supplement'
import { PathField } from './PathField'

const emptyTargets = () =>
  Object.fromEntries(CHARACTER_GROUPS.map((group) => [group, null])) as SupplementOptions['targets']
const emptyCharacters = () =>
  Object.fromEntries(
    CHARACTER_GROUPS.map((group) => [group, ''])
  ) as SupplementOptions['characters']
const colorHex = (rgb: number[]) => '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('')
const parseColor = (hex: string) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
const ratio = (count: number, total: number) =>
  total ? ((100 * count) / total).toFixed(2) : '0.00'

export function SupplementSettings({
  directory,
  busy,
  enabled,
  setEnabled,
  additionalCharacters,
  setAdditionalCharacters,
  onSelect,
  saved
}: {
  directory: string
  busy: boolean
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  additionalCharacters: string
  setAdditionalCharacters: (value: string) => void
  onSelect: (id: string | null) => void
  saved?: SupplementPreview | null
}): React.JSX.Element {
  const [info, setInfo] = useState<SupplementInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SupplementPreview | null>(null)
  const [pending, setPending] = useState(false)
  const [tolerance, setTolerance] = useState('')
  const [options, setOptions] = useState<SupplementOptions>({
    additionalCharacters,
    pythonExecutable: '',
    targets: emptyTargets(),
    characters: emptyCharacters(),
    tolerance: 0,
    maxImages: 10000,
    seed: 42,
    profile: 'dotum',
    fonts: {
      gulim: 'C:/Windows/Fonts/gulim.ttc',
      batang: 'C:/Windows/Fonts/batang.ttc',
      nanum: '',
      uttum: ''
    },
    scale: 1,
    width: 160,
    height: 32,
    padding: 0,
    color: [75, 209, 255],
    backgroundMode: 'solid',
    backgroundColor: [24, 28, 32],
    backgroundDirectory: ''
  })
  const disabled = busy || pending
  useEffect(() => {
    let disposed = false
    void window.training
      .supplementInfo()
      .then((result) => {
        if (disposed) {
          return
        }
        if (result.ok) {
          setInfo(result.value)
          setOptions((value) => ({
            ...value,
            width: Math.max(4, result.value.width),
            height: Math.max(4, result.value.height)
          }))
        } else {
          setError(result.error)
        }
      })
      .catch(() => {
        if (!disposed) {
          setError('실제 문자 분포를 읽지 못했습니다.')
        }
      })
    return () => {
      disposed = true
    }
  }, [directory])

  function change(next: Partial<SupplementOptions>): void {
    setOptions((value) => ({ ...value, ...next }))
    setPreview(null)
    onSelect(null)
  }
  async function choose(kind: 'python' | 'output'): Promise<void> {
    const result = await window.evaluation.choosePath(kind)
    if (!result.ok) {
      setError(result.error)
    } else if (result.value) {
      change(
        kind === 'python'
          ? { pythonExecutable: result.value }
          : { backgroundDirectory: result.value }
      )
    }
  }
  async function prepare(): Promise<void> {
    setPending(true)
    setError(null)
    setPreview(null)
    onSelect(null)
    try {
      const result = await window.training.previewSupplement({
        ...options,
        additionalCharacters,
        tolerance: Number(tolerance)
      })
      if (!result.ok) {
        setError(result.error)
      } else {
        setPreview(result.value)
        onSelect(result.value.id)
      }
    } catch {
      setError('합성 미리보기를 준비하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }
  const current = preview?.options.additionalCharacters === additionalCharacters ? preview : null
  return (
    <section className="panel supplement-settings" aria-label="Train 문자 구성">
      <h3>Train 문자 구성</h3>
      <p>
        실제 train은 모두 유지합니다. 목표는 실제+합성 정답의 문자 수 비율이며 val/test는 가져온
        입력을 그대로 사용합니다.
      </p>
      {info && (
        <p className="field-help">
          실제 train {info.real.images}장 · 닉네임 {info.real.nicknames}개 · 정답 문자{' '}
          {info.real.characters}개 · 모델 사전 {info.dictionarySize}자
        </p>
      )}
      {info && (
        <details>
          <summary>실제 문자 빈도 보기</summary>
          <p className="character-frequencies">
            {info.real.frequencies
              .map((item) => `${JSON.stringify(item.character)} ${item.count}회`)
              .join(' · ')}
          </p>
        </details>
      )}
      <details className="training-runtime" open={Boolean(info?.missing.length)}>
        <summary>모델 사전 확장</summary>
        {info?.missing.length ? (
          <p role="status">
            현재 사전에 없는 실제 정답 문자:{' '}
            {info.missing.map((item) => `${item.character} (${item.count}회)`).join(' · ')}. 정답은
            그대로 보존됩니다.
          </p>
        ) : (
          <p className="field-help">
            현재 실제 정답은 모델 사전 안에 있습니다. 합성에 필요한 새 문자는 아래에 직접 추가할 수
            있습니다.
          </p>
        )}
        <label className="field">
          모델에 추가할 문자
          <textarea
            value={additionalCharacters}
            disabled={disabled}
            onChange={(event) => {
              setAdditionalCharacters(event.target.value)
              setPreview(null)
              onSelect(null)
            }}
            placeholder="예: ★☆龍電あいうアイウ"
          />
        </label>
        <p className="field-help">
          입력한 새 문자는 기존 사전 뒤에 추가하고 해당 출력층을 새로 학습합니다. 기존 모델은
          유지하며 새 모델로 저장합니다. 사전 밖 실제 문자가 남아 있으면 학습할 수 없습니다.
        </p>
      </details>
      <label className="supplement-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />{' '}
        부족한 문자군을 합성으로 보충
      </label>
      {enabled && (
        <>
          <div className="supplement-table-scroll">
            <table className="supplement-table">
              <thead>
                <tr>
                  <th>문자군</th>
                  <th>실제</th>
                  <th>목표 (%)</th>
                  <th>합성에 사용할 문자</th>
                  <th>최종 예상</th>
                  <th>차이 (%p)</th>
                </tr>
              </thead>
              <tbody>
                {CHARACTER_GROUPS.map((group) => (
                  <tr key={group}>
                    <th>{CHARACTER_GROUP_LABELS[group]}</th>
                    <td>
                      {info
                        ? `${info.real.groups[group]} · ${ratio(info.real.groups[group], info.real.characters)}%`
                        : '—'}
                    </td>
                    <td>
                      <input
                        aria-label={`${CHARACTER_GROUP_LABELS[group]} 목표 (%)`}
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={options.targets[group] ?? ''}
                        disabled={disabled}
                        onChange={(event) =>
                          change({
                            targets: {
                              ...options.targets,
                              [group]: event.target.value === '' ? null : Number(event.target.value)
                            }
                          })
                        }
                      />
                    </td>
                    <td>
                      <textarea
                        aria-label={`${CHARACTER_GROUP_LABELS[group]} 합성 문자`}
                        rows={2}
                        value={options.characters[group]}
                        disabled={disabled}
                        onChange={(event) =>
                          change({
                            characters: { ...options.characters, [group]: event.target.value }
                          })
                        }
                      />
                    </td>
                    <td>
                      {current
                        ? `${current.plan.final.groups[group]} · ${ratio(current.plan.final.groups[group], current.plan.final.characters)}%`
                        : '—'}
                    </td>
                    <td>{current?.plan.differences[group]?.toFixed(2) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-help">
            목표가 빈 문자군은 목표 검사에서 제외합니다. 문자 목록이 빈 문자군은 합성하지 않습니다.
            실제 빈도를 참고해 자주 쓰는 문자를 붙여넣으세요. 선택한 문자 사이의 편중과 닉네임
            중복을 줄입니다.
          </p>
          <div className="supplement-fields">
            <label className="field">
              허용 오차 (%p)
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={tolerance}
                disabled={disabled}
                placeholder="직접 입력"
                onChange={(event) => {
                  setTolerance(event.target.value)
                  setPreview(null)
                  onSelect(null)
                }}
              />
            </label>
            <label className="field">
              합성 이미지 상한
              <input
                type="number"
                min="1"
                max="100000"
                value={options.maxImages}
                disabled={disabled}
                onChange={(event) => change({ maxImages: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              합성 seed
              <input
                type="number"
                min="0"
                max="4294967295"
                value={options.seed}
                disabled={disabled}
                onChange={(event) => change({ seed: Number(event.target.value) })}
              />
            </label>
          </div>
          <details className="training-runtime" open>
            <summary>합성 글자와 배경</summary>
            <PathField
              id="synth-python"
              label="합성용 Python"
              value={options.pythonExecutable}
              placeholder="dnf-ocr-synth가 설치된 Python"
              disabled={disabled}
              onChoose={() => void choose('python')}
            />
            <p className="field-help">
              합성기는 Pillow 12.3 이상을 사용합니다. GPU 학습 Python과 별도 환경을 선택할 수 있으며
              폰트는 이 PC의 파일만 읽습니다.
            </p>
            <div className="supplement-fields">
              <label className="field">
                글꼴 모드
                <select
                  value={options.profile}
                  disabled={disabled}
                  onChange={(event) =>
                    change({ profile: event.target.value as SupplementOptions['profile'] })
                  }
                >
                  <option value="dotum">돋움</option>
                  <option value="nanum-neo">나눔스퀘어 네오</option>
                </select>
              </label>
              {(['scale', 'width', 'height', 'padding'] as const).map((key) => (
                <label className="field" key={key}>
                  {
                    {
                      scale: '글자 배율',
                      width: '크롭 너비 (px)',
                      height: '크롭 높이 (px)',
                      padding: '최소 여백 (px)'
                    }[key]
                  }
                  <input
                    type="number"
                    min={key === 'padding' ? 0 : 0.01}
                    step="any"
                    value={options[key]}
                    disabled={disabled}
                    onChange={(event) => change({ [key]: Number(event.target.value) })}
                  />
                </label>
              ))}
              <label className="field">
                글자 색
                <input
                  type="color"
                  value={colorHex(options.color)}
                  disabled={disabled}
                  onChange={(event) => change({ color: parseColor(event.target.value) })}
                />
              </label>
            </div>
            <details>
              <summary>로컬 폰트 경로</summary>
              {(['gulim', 'batang', 'nanum', 'uttum'] as const).map((key) => (
                <label className="field" key={key}>
                  {
                    {
                      gulim: 'gulim.ttc · 돋움',
                      batang: 'batang.ttc · 한자·대체 글꼴',
                      nanum: 'NanumSquareNeoOTF-cBd.otf',
                      uttum: '으뜸체 · 돋움 영문 I'
                    }[key]
                  }
                  <input
                    value={options.fonts[key]}
                    disabled={disabled}
                    placeholder="로컬 폰트의 전체 경로"
                    onChange={(event) =>
                      change({ fonts: { ...options.fonts, [key]: event.target.value } })
                    }
                  />
                </label>
              ))}
            </details>
            <div className="supplement-fields">
              <label className="field">
                배경 종류
                <select
                  value={options.backgroundMode}
                  disabled={disabled}
                  onChange={(event) =>
                    change({
                      backgroundMode: event.target.value as SupplementOptions['backgroundMode']
                    })
                  }
                >
                  <option value="solid">고정 UI 색상</option>
                  <option value="images">글자가 없는 배경 조각</option>
                </select>
              </label>
              {options.backgroundMode === 'solid' && (
                <label className="field">
                  배경 색
                  <input
                    type="color"
                    value={colorHex(options.backgroundColor)}
                    disabled={disabled}
                    onChange={(event) =>
                      change({ backgroundColor: parseColor(event.target.value) })
                    }
                  />
                </label>
              )}
            </div>
            {options.backgroundMode === 'images' && (
              <>
                <PathField
                  id="synth-background"
                  label="배경 이미지 폴더"
                  value={options.backgroundDirectory}
                  placeholder="텍스트 없는 PNG/JPEG 폴더"
                  disabled={disabled}
                  onChoose={() => void choose('output')}
                />
                <p className="field-help">
                  불투명하고 크롭보다 큰 배경을 준비하세요. 닉네임마다 배경과 위치를 선택하며 모든
                  조합을 복제하지 않습니다.
                </p>
              </>
            )}
          </details>
          <button
            className="button button-secondary"
            disabled={disabled || !options.pythonExecutable || tolerance === ''}
            onClick={() => void prepare()}
          >
            보충량 계산·합성 미리보기
          </button>
          <p className="field-help">
            허용 오차 안에 들어오는 부족분을 계산합니다. 목표 미달이나 비율 오차는 경고로 표시하며,
            입력 오류와 구분합니다.
          </p>
          {current && (
            <div className="supplement-preview">
              <p role="status">
                계산한 부족분 {current.plan.requestedCharacters}자 · 생성 예상{' '}
                {current.plan.synthetic.images}장 · 문자 {current.plan.synthetic.characters}개 ·
                실제 train {current.plan.real.images}장 유지
              </p>
              {current.plan.warnings.map((warning) => (
                <p key={warning} className="field-help">
                  {warning}
                </p>
              ))}
              <div className="supplement-examples">
                {current.examples.map((example, index) => (
                  <figure key={index}>
                    <img src={example.image} alt={`합성 예시 ${example.text}`} />
                    <figcaption>{example.text}</figcaption>
                  </figure>
                ))}
              </div>
              <p>
                이 구성은 다음 학습 실행의 train에만 추가됩니다. 설정을 바꾸면 다시 미리보기하세요.
              </p>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {saved && saved.id === '' && (
        <details>
          <summary>저장된 실행의 합성 구성</summary>
          <p>
            합성 {saved.plan.synthetic.images}장 · 허용 오차 {saved.options.tolerance}%p · seed{' '}
            {saved.options.seed} · {saved.options.profile} · 배율 {saved.options.scale}
          </p>
          <p>
            목표:{' '}
            {CHARACTER_GROUPS.filter((group) => saved.options.targets[group] !== null)
              .map((group) => `${CHARACTER_GROUP_LABELS[group]} ${saved.options.targets[group]}%`)
              .join(' · ')}
          </p>
          <p>모델 추가 문자: {saved.options.additionalCharacters || '없음'}</p>
          <div className="supplement-examples">
            {saved.examples.map((example, index) => (
              <figure key={index}>
                <img src={example.image} alt={`저장한 합성 예시 ${example.text}`} />
                <figcaption>{example.text}</figcaption>
              </figure>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
