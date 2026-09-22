# 실행 및 개발 안내

[README로 돌아가기](../README.md)

Windows GPU PC에서 **ldb-ocr 체크포인트와 라벨이 있는 Cropper ROI를 반복 평가하는 로컬 Electron 앱**입니다. 모델과 데이터 경로를 선택해 평가하고, 틀린 샘플을 확인하며, 실행별 `report.json`을 저장합니다.

**Dataset** 탭에서는 캡처 이벤트를 train / val / test에 직접 배정하고 검사·확정한 목록을 저장합니다. [Dataset 사용 안내](dataset.md)를 참고하세요.

**결과 비교** 탭에서는 완료된 `report.json` 두 개의 성적과 샘플별 차이를 봅니다. 모델이나 GPU를 실행하지 않습니다. [결과 비교 사용 안내](comparison.md)를 참고하세요.

**문자 검사** 탭에서는 학습 설정·문자 사전과 `labels.json`만으로 문자 빈도·포함률·누락을 확인합니다. 이미지·가중치·Python이 필요하지 않습니다. [문자 검사 사용 안내](charset.md)를 참고하세요.

평가 샘플의 확대창에서 **모델 입력 확인**을 누르면 실제 전처리와 최종 입력을 확인하고, 상세 정보에서 학습·평가 모드의 주요 shape를 봅니다. 해당 평가의 Python·모델·원본 파일이 필요합니다. [모델 입력 확인 안내](model-input.md)를 참고하세요.

## Windows 패키지 실행

[최신 릴리즈](https://github.com/blahaj94/dfragon-ocr-eval-tool/releases/latest)에서 Windows x64 패키지를 받습니다.

- `DFragon-OCR-Eval-버전-x64-setup.exe`: 설치 후 **Real OCR Evaluation** 실행.
- `DFragon-OCR-Eval-버전-x64.zip`: 폴더 전체를 압축 해제한 뒤 **Real OCR Evaluation.exe** 실행. EXE만 따로 옮기지 마세요.
- `SHA256SUMS.txt`: 다운로드 파일 무결성 확인용 체크섬.

패키지 실행에는 Node.js·pnpm 설치가 필요 없습니다. 평가·모델 입력 확인에는 기존 Python GPU 환경·Git·학습 소스·모델이 필요하며, Dataset 검사에는 Python 3.12와 Pillow가 필요합니다. 이 환경과 모델·데이터는 패키지에 포함하지 않습니다. 결과 비교·문자 검사는 해당 입력 파일만 있으면 됩니다.

첫 배포는 코드 서명 없는 패키지입니다. Windows에서 게시자를 확인할 수 없다는 안내가 표시될 수 있습니다.

## 소스에서 실행하기

아래 GPU·Python·소스 요건은 **평가 실행과 모델 입력 확인**에 해당합니다. 결과 비교와 문자 검사는 Node.js·pnpm으로 앱을 실행한 뒤 각 화면에 필요한 입력 파일만 선택하면 됩니다.

- Node.js 24와 pnpm 11.23.0. 기록된 PaddleOCR revision 검증을 위해 PATH에서 실행 가능한 Git도 필요합니다.
- Python 3.12와 해당 체크포인트의 추론이 가능한 기존 Windows GPU/Paddle 환경. 확인한 학습 환경은 `paddlepaddle-gpu==3.2.2`, `numpy==2.2.6` 및 ldb-ocr의 Pillow·PyYAML·PaddleOCR 의존성을 사용합니다.
- 학습에 사용한 **ldb-ocr 소스 스냅샷**, 학습 결과 폴더, 체크포인트 및 학습 설정·문자 사전.
- Cropper 캡처 루트와 아래 형식의 `labels.json`.

`ldb-ocr 소스 폴더`에는 `python/src/ldb_ocr/training/checkpoint.py`가 들어 있는 저장소 최상위 폴더를 선택합니다. Python은 Paddle·NumPy가 설치된 기존 학습 가상환경의 실행 파일을 선택하세요. 일반 Python 설치만으로는 평가 의존성이 준비되지 않습니다.

앱은 GPU 환경을 설치하거나 학습 코드를 내려받지 않습니다. 현재 지원 로더가 포함된 기존 학습 소스 스냅샷을 선택해야 합니다. 확인한 ldb-ocr GitHub main에는 해당 로더가 없으므로 새 clone만으로 실행 준비가 끝나지 않습니다. 소스·가중치·실제 이미지·접속 정보는 이 저장소에 포함하지 않습니다.

학습 결과 폴더에는 `request.json`, `training.json`, `config.yml`, `characters.txt`, `manifest.jsonl`과 `checkpoints/latest.pdparams`가 필요합니다. `training.json`의 `checkpointFiles`에 기록된 파일도 모두 있어야 합니다. 확인한 실행은 `latest.pdopt`, `latest.states`도 요구합니다. 기록된 PaddleOCR 소스와 경로·revision을 그대로 사용하므로 가중치만 복사하거나 학습 폴더를 임의로 옮긴 구성은 지원하지 않습니다.

```sh
pnpm install
pnpm dev
```

빌드한 앱을 실행하려면 다음 명령을 사용합니다.

```sh
pnpm build
pnpm start
```

실제 평가는 Windows GPU PC에서 실행합니다. 다른 OS의 UI·계약 테스트 통과가 Windows GPU 추론 성공을 의미하지는 않습니다.

Windows에서 동일한 설치 파일과 ZIP을 빌드하려면 다음 명령을 실행합니다. 결과물은 `dist/`에 생성되며 자동 업로드하지 않습니다.

```sh
pnpm install --frozen-lockfile
pnpm package:win
```

패키징은 고정된 electron-builder 버전과 저장소의 빨간 용 아이콘을 사용합니다. Python 작업 파일은 외부 Python이 읽을 수 있는 `resources/python/`에 배치합니다. 가상환경·테스트·모델·데이터는 배포 파일에 넣지 않습니다. NSIS를 사용하므로 불필요한 Squirrel 패키징 도구의 설치 스크립트는 실행하지 않습니다.

## 평가하기

1. **Python 실행 파일** 목록에서 설치된 버전·경로를 확인하고 Python 3.12 환경을 선택합니다. Windows Python 런처와 PATH에서 찾으며, 목록에 없는 가상환경은 **찾아보기**로 추가합니다. 이어 ldb-ocr 소스 폴더를 선택합니다.
2. 학습 결과 폴더를 선택하고 지원되는 체크포인트를 선택합니다. 현재 로더 지원 대상은 `checkpoints/latest.pdparams`입니다.
3. Cropper의 `captures` 루트와 정답 파일을 선택합니다. Cropper에 정답을 저장해 두었다면 **정답 목록 만들기**로 새 JSON을 만들고 자동 선택할 수 있습니다. 이어 보고서를 저장할 폴더를 선택합니다.
4. 평가를 시작합니다. 동시에 하나만 실행하며 처리 수를 표시합니다. 취소하면 결과를 완료된 전체 성적으로 표시하지 않습니다.
5. 기본으로 표시되는 오답 목록에서 이미지·정답·예측·편집거리·모델이 제공하는 confidence를 확인합니다. 전체 보기와 이미지 확대도 지원합니다.

평가가 완료되면 CER, Exact Match, 평가 샘플 수, 정답 문자 수를 표시합니다. 빈 예측과 낮은 confidence도 정상 추론 결과이면 집계에 포함합니다. confidence가 제공되지 않으면 값이 없는 상태로 표시합니다.

평가 설정에서 고른 Python·경로·체크포인트는 자동 저장되어 앱을 다시 열어도 유지됩니다. 저장된 Python을 우선하며, 처음에는 발견한 Python 3.12를 선택합니다. 다른 버전은 목록에서 미지원으로 표시합니다. 목록은 버전을 확인한 결과이며 GPU 의존성 설치 여부를 판정하지 않습니다. 저장 실패는 화면에 표시하고 기존 설정 파일을 보존합니다.

보고서 폴더는 학습 결과·캡처 루트·ldb-ocr 소스 폴더 밖에 선택하세요. 취소는 현재 모델 초기화나 샘플 추론이 끝난 뒤 반영될 수 있습니다.

문자열을 정규화하거나 공백을 자르지 않습니다. CER는 전체 편집거리 합계 / 정답 문자 수이며, Exact Match는 완전히 같은 예측 수 / 평가 샘플 수입니다. 현재 ldb-ocr 디코더는 텍스트만 반환하므로 confidence는 `null`입니다.

## 라벨과 캡처 형식

`labels.json`은 이 도구에서 정의한 명시적인 정답 목록입니다. Cropper의 **Ground Truth** 탭에서 저장한 정답은 평가 설정의 [정답 목록 만들기](transfer.md)로 변환할 수 있습니다. 평가 앱에서는 라벨을 편집하지 않습니다. [예제 라벨](../examples/labels.json)은 형식 설명용 가상 데이터입니다.

```json
{
  "schemaVersion": 1,
  "samples": [
    {
      "id": "example-1",
      "image": "20260922-120000-1234abcd/001.png",
      "truth": "샘플"
    }
  ]
}
```

- `id`, `image`, `truth`는 비어 있지 않은 문자열입니다. ID와 이미지 경로는 중복될 수 없습니다.
- `image`는 선택한 캡처 루트 기준의 `/` 구분 상대 경로입니다. 절대 경로, `..`, Windows `\` 구분 경로는 허용하지 않습니다.
- 이미지의 이벤트 폴더에 Cropper `metadata.json`이 있어야 하며, 등록된 ROI 파일명·좌표·크기가 일치해야 합니다. `original.png`는 평가 대상이 아닙니다.
- 전체 캡처 중 일부만 등록해도 됩니다. 목록에 없는 PNG는 평가하지 않습니다. 라벨 파일은 캡처 루트 밖에 있어도 됩니다.
- 잘못된 라벨, 누락된 파일, 유효하지 않은 metadata는 오류로 알립니다. 잘못된 행을 조용히 제외하지 않습니다.

지원 모델의 기존 전처리 계약은 최대 `384 × 48`의 불투명 RGB/RGBA PNG입니다. 전처리는 ldb-ocr의 반전 grayscale 및 오른쪽·아래쪽 패딩 정책을 그대로 사용합니다. 큰 이미지를 임의로 축소하거나 모델의 pooling·사전·설정을 대체하지 않습니다.

```text
captures/                          ← 선택할 캡처 루트
└── 20260922-120000-1234abcd/
    ├── metadata.json              ← Cropper schemaVersion 1
    ├── 001.png                    ← 라벨에 등록된 ROI
    ├── 002.png                    ← 라벨에 없으면 평가하지 않음
    └── original.png               ← 선택적 원본, 평가하지 않음
```

## 보고서와 파일 보호

실행마다 출력 폴더 아래에 새 폴더를 만들고 `report.json`을 저장합니다. 원본 PNG·라벨·체크포인트·학습 설정·이전 보고서를 덮어쓰지 않습니다. 저장 실패는 화면에 표시합니다.

보고서의 `status`는 `completed`, `cancelled`, `failed`를 구분합니다. 완료된 실행만 전체 성적 `summary`를 가지며, 취소·실패 시 처리된 샘플과 부분 집계는 전체 성적과 구분합니다. 입력 검증부터 실패한 실행에는 처리된 샘플이 없을 수 있습니다.

## 개발과 검증

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:ui
pnpm test:python
pnpm lint:python
pnpm format:python:check
pnpm build
```

Python 개발 검사는 uv와 Python 3.12를 사용하며 `python/uv.lock`에 고정된 pytest·Ruff·NumPy를 별도 개발 환경에서 실행합니다. `pnpm test:python`의 실제 명령은 `uv run --project python --group dev pytest -q python/tests`입니다. 이 환경에는 Paddle/GPU 패키지를 설치하지 않습니다. 앱에서 선택하는 기존 GPU 추론 환경과 구분하세요.

v0.1.1에서는 설치된 Python 버전 선택과 평가 설정 자동 저장을 추가했습니다. lint·format·typecheck·build, Vitest 102개와 Playwright 33개를 통과했습니다. 실제 Windows 패키지에서 설치된 Python 3.12·3.13·3.14 검색, 미지원 버전 표시, 선택 및 경로·체크포인트 저장과 재시작 후 복원을 확인했습니다. 이 수정판의 검증에서는 GPU 추론을 다시 실행하지 않았습니다.

모델 입력 확인 추가 후 lint·format·typecheck·build, Vitest 94개, Playwright 28개를 통과했습니다. Python 전체 테스트 63개 통과 후 추가한 PNG 누락 회귀 테스트 1개도 통과했습니다. Ruff lint·format 검사도 통과했습니다. 기존 평가·Dataset·결과 비교·문자 검사 흐름을 포함합니다.

진단 테스트는 실제 전처리 호출의 관찰 전후 값·shape·dtype, 미리보기 불변성, 같은 초기 모델 상태·hook 정리, 파일 변경·누락 거부, 측정 실패 표시와 작업 잠금을 확인합니다. Python의 가짜 모델 및 Playwright의 UI fixture 검사는 실제 Windows 모델 실행 검증과 구분합니다.

모델 입력 확인은 Windows 실제 앱에서 사용자 체크포인트와 합성 ROI 3개로 평가 → 샘플 선택 → 기본 진단 → 상세 정보까지 통과했습니다. 실제 전처리 5단계와 `adaptive40`의 train/eval shape를 관측했습니다. 관찰 전후 최종 입력 값·shape·dtype이 같고 미리보기가 입력을 바꾸지 않는 별도 검사도 통과했습니다. 원본 보고서 바이트와 모델·설정·소스·PNG·metadata·라벨 21개 파일의 해시가 유지됐습니다. 이 과정에서 발견한 완료 표시와 프로세스 종료 사이의 경합도 수정하여 실제 종료까지 새 작업이 잠기도록 했습니다.

Windows Electron에서도 앱 시작과 sandboxed preload, 실제 Python worker 실행 및 잘못된 입력의 실패 보고서 저장, 허용되지 않은 이미지 읽기 거절을 확인했습니다. 결과 비교는 고정 보고서로 네 그룹·배열 순서 독립 대조·이미지 확대·입력 불일치 거부를 확인했고 원본 바이트가 유지됐습니다.

문자 검사는 Windows 실제 앱에서 텍스트 파일 4개만 있는 예제 폴더로 고유 문자 7개·포함 5개·누락 2개와 공백·U+200B·이모지 표시를 확인했습니다. 사용자의 실제 학습 폴더에도 합성 정답 목록을 대조해 설정·사전 읽기 연결을 확인했으며, 원본 설정·사전 해시는 변경되지 않았습니다. 문자 검사 스크린샷은 고정 예제이며 가중치·이미지·Python·GPU를 사용하지 않았습니다.

Windows의 기존 GPU 환경에서 사용자 체크포인트를 실제 로드하고 기존 검증 PNG 2개를 순차 추론하는 adapter 연결 검사를 통과했습니다. 이어 합성 예제 이미지 3개와 Cropper 형식 metadata·라벨로 실제 Electron 앱의 입력 선택 → GPU 추론 → 결과 확인 → 보고서 저장 → 이미지 확대까지 확인했습니다. README의 평가 스크린샷은 이 실행을 Playwright로 직접 캡처한 것이며 예측값이나 화면을 조작하지 않았습니다. 결과 비교 스크린샷은 별도의 고정 예제 보고서를 실제 앱에서 연 것입니다. 작은 예제의 수치는 사용법 시연용이며 모델 성능을 판단하는 벤치마크가 아닙니다.

Windows 검증 중 발견한 NumPy 초기화 멈춤은 표준 입력을 읽는 별도 스레드를 제거하고 실행별 임시 취소 파일을 확인하도록 수정해 해결했습니다. 기존 모델 로딩·전처리·디코딩은 변경하지 않았습니다.

실제 라벨이 있는 Cropper 데이터셋은 아직 검증하지 못했습니다. UI fixture 검사에서 사용하는 가짜 예측은 실제 GPU 검증으로 계산하지 않습니다.

## 참고한 관례

- LDB `9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6`의 [Electron 설정](https://github.com/blahaj94/ldb/blob/9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6/apps/desktop/electron.vite.config.ts), [main](https://github.com/blahaj94/ldb/blob/9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6/apps/desktop/src/backend/main.ts), [typed IPC](https://github.com/blahaj94/ldb/blob/9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6/apps/desktop/src/preload/ipc.ts): backend/preload/frontend 경계, TypeScript·React 구성, pnpm 개발 명령을 참고했습니다. 참조 checkout의 기존 변경은 보존했습니다.
- Cropper `7ece8bd8f605393febea4e849608f25664dc8bd8`의 [캡처 저장](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/src/main/capture/index.ts), [metadata 검증](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/src/main/capture/history/metadata.ts), [IPC 보안](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/src/main/window-security.ts), [Playwright 검증](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/tests/ui/history-preview.spec.ts): 실제 캡처 계약, 제한된 로컬 파일 접근, 독립 fixture 검증을 참고했습니다.

별도 소형 앱에 필요한 범위만 적용했습니다. LDB의 monorepo UI 패키지 대신 React와 일반 CSS를 사용하고, ldb-ocr의 모델 로딩·전처리·디코딩·평가 코드는 복제하지 않고 선택한 소스에서 불러옵니다.

결과 비교는 기존 보고서 검증 함수와 이미지·확대 컴포넌트를 재사용합니다. 문자 검사는 기존 Python 라벨 검증이 PNG까지 읽기 때문에 텍스트 구조 규칙만 Node에서 적용하며, 실제 ldb-ocr 사전 reader·CTC 클래스와 공백 설정 해석을 따릅니다. YAML 설정은 표준 파서로 읽고 추론 로더·평가 계산은 변경하지 않았습니다.

모델 입력 확인은 기존 typed IPC·Python 프로세스·이미지 확대 구조를 사용합니다. ldb-ocr 소스를 수정하는 대신 검증한 전처리 함수의 반환 시점에서 실제 배열을 관찰합니다. 평가와 진단의 입력 준비는 같은 adapter 함수를 호출하며, 상세 shape는 별도 모델의 backbone hook으로 측정합니다.

ldb-ocr 소스 스냅샷의 주요 재사용 지점은 `training/checkpoint.py`의 `load_trained_checkpoint`, `training/preprocessing.py`의 `tensor_from_png`, `training/evaluation.py`의 `character_classes`·`decode_output`, `recognition/metrics.py`의 `recognition_metrics`, `recognition/distance.py`의 `edit_distance`입니다. 경로와 해시는 로컬 보고서에 남으며 모델 파일이나 실제 이미지를 보고서 폴더로 복사하지 않습니다.
