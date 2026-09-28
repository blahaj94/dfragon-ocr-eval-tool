import type { SupplementOptions } from '../../../shared/supplement'
import { PathField } from './PathField'

const colorHex = (rgb: number[]) => '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('')
const parseColor = (hex: string) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))

export function SupplementAppearance({
  options,
  disabled,
  onChange,
  onChoosePath
}: {
  options: SupplementOptions
  disabled: boolean
  onChange: (value: Partial<SupplementOptions>) => void
  onChoosePath: (kind: 'python' | 'output') => void
}): React.JSX.Element {
  return (
    <details className="training-runtime" open>
      <summary>합성 글자와 배경</summary>
      <PathField
        id="synth-python"
        label="합성용 Python"
        value={options.pythonExecutable}
        placeholder="dnf-ocr-synth가 설치된 Python"
        disabled={disabled}
        onChoose={() => onChoosePath('python')}
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
              onChange({ profile: event.target.value as SupplementOptions['profile'] })
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
              onChange={(event) => onChange({ [key]: Number(event.target.value) })}
            />
          </label>
        ))}
        <label className="field">
          글자 색
          <input
            type="color"
            value={colorHex(options.color)}
            disabled={disabled}
            onChange={(event) => onChange({ color: parseColor(event.target.value) })}
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
                onChange({ fonts: { ...options.fonts, [key]: event.target.value } })
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
              onChange({
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
              onChange={(event) => onChange({ backgroundColor: parseColor(event.target.value) })}
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
            onChoose={() => onChoosePath('output')}
          />
          <p className="field-help">
            불투명하고 크롭보다 큰 배경을 준비하세요. 닉네임마다 배경과 위치를 선택하며 모든 조합을
            복제하지 않습니다.
          </p>
        </>
      )}
    </details>
  )
}
