# 실행 및 개발 안내

[README로 돌아가기](../README.md)

Windows GPU PC에서 **ldb-ocr 체크포인트와 라벨이 있는 Cropper ROI를 반복 평가하는 로컬 Electron 앱**입니다. 모델과 데이터 경로를 선택해 평가하고, 틀린 샘플을 확인하며, 실행별 `report.json`을 저장합니다.

**Dataset** 탭에서는 캡처 이벤트를 train / val / test에 직접 배정하고 검사·확정한 목록을 저장합니다. [Dataset 사용 안내](dataset.md)를 참고하세요.

## 실행 준비

- Node.js 24와 pnpm 11.23.0. 기록된 PaddleOCR revision 검증을 위해 PATH에서 실행 가능한 Git도 필요합니다.
- Python 3.12와 해당 체크포인트의 추론이 가능한 기존 Windows GPU/Paddle 환경. 확인한 학습 환경은 `paddlepaddle-gpu==3.2.2`, `numpy==2.2.6` 및 ldb-ocr의 Pillow·PyYAML·PaddleOCR 의존성을 사용합니다.
- 학습에 사용한 **ldb-ocr 소스 스냅샷**, 학습 결과 폴더, 체크포인트 및 학습 설정·문자 사전.
- Cropper 캡처 루트와 아래 형식의 `labels.json`.

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

## 평가하기

1. 기존 GPU 환경의 `python.exe`와 ldb-ocr 소스 폴더를 선택합니다.
2. 학습 결과 폴더를 선택하고 지원되는 체크포인트를 선택합니다. 현재 로더 지원 대상은 `checkpoints/latest.pdparams`입니다.
3. Cropper의 `captures` 루트, `labels.json`, 보고서를 저장할 폴더를 선택합니다.
4. 평가를 시작합니다. 동시에 하나만 실행하며 처리 수를 표시합니다. 취소하면 결과를 완료된 전체 성적으로 표시하지 않습니다.
5. 기본으로 표시되는 오답 목록에서 이미지·정답·예측·편집거리·모델이 제공하는 confidence를 확인합니다. 전체 보기와 이미지 확대도 지원합니다.

평가가 완료되면 CER, Exact Match, 평가 샘플 수, 정답 문자 수를 표시합니다. 빈 예측과 낮은 confidence도 정상 추론 결과이면 집계에 포함합니다. confidence가 제공되지 않으면 값이 없는 상태로 표시합니다.

보고서 폴더는 학습 결과·캡처 루트·ldb-ocr 소스 폴더 밖에 선택하세요. 취소는 현재 모델 초기화나 샘플 추론이 끝난 뒤 반영될 수 있습니다.

문자열을 정규화하거나 공백을 자르지 않습니다. CER는 전체 편집거리 합계 / 정답 문자 수이며, Exact Match는 완전히 같은 예측 수 / 평가 샘플 수입니다. 현재 ldb-ocr 디코더는 텍스트만 반환하므로 confidence는 `null`입니다.

## 라벨과 캡처 형식

`labels.json`은 이 도구에서 정의한 명시적인 정답 목록입니다. Cropper가 자동 생성하는 파일이 아니며, 앱에서는 라벨을 편집하지 않습니다. [예제 라벨](../examples/labels.json)은 형식 설명용 가상 데이터입니다.

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

Python 개발 검사는 uv와 Python 3.12를 사용하며 `python/uv.lock`에 고정된 pytest·Ruff를 별도 개발 환경에서 실행합니다. `pnpm test:python`의 실제 명령은 `uv run --project python --group dev pytest -q python/tests`입니다. 이 환경에는 Paddle/GPU 패키지를 설치하지 않습니다. 앱에서 선택하는 기존 GPU 추론 환경과 구분하세요.

평가 및 Dataset 검증에서 lint·format·typecheck·build, Vitest 20개, pytest 42개, Playwright 12개를 통과했습니다. Windows Electron에서도 앱 시작과 sandboxed preload, 실제 Python worker 실행 및 잘못된 입력의 실패 보고서 저장, 허용되지 않은 이미지 읽기 거절을 확인했습니다.

Windows의 기존 GPU 환경에서 사용자 체크포인트를 실제 로드하고 기존 검증 PNG 2개를 순차 추론하는 adapter 연결 검사를 통과했습니다. 이어 합성 예제 이미지 3개와 Cropper 형식 metadata·라벨로 실제 Electron 앱의 입력 선택 → GPU 추론 → 결과 확인 → 보고서 저장 → 이미지 확대까지 확인했습니다. README의 스크린샷은 이 실행을 Playwright로 직접 캡처한 것이며 예측값이나 화면을 조작하지 않았습니다. 작은 글꼴로 만든 예제의 수치는 사용법 시연용이며 모델 성능을 판단하는 벤치마크가 아닙니다.

Windows 검증 중 발견한 NumPy 초기화 멈춤은 표준 입력을 읽는 별도 스레드를 제거하고 실행별 임시 취소 파일을 확인하도록 수정해 해결했습니다. 기존 모델 로딩·전처리·디코딩은 변경하지 않았습니다.

실제 라벨이 있는 Cropper 데이터셋은 아직 검증하지 못했습니다. UI fixture 검사에서 사용하는 가짜 예측은 실제 GPU 검증으로 계산하지 않습니다.

## 참고한 관례

- LDB `9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6`의 [Electron 설정](https://github.com/blahaj94/ldb/blob/9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6/apps/desktop/electron.vite.config.ts), [main](https://github.com/blahaj94/ldb/blob/9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6/apps/desktop/src/backend/main.ts), [typed IPC](https://github.com/blahaj94/ldb/blob/9ebc1c7a6e72210a78d4a702ebb4d2869e0864d6/apps/desktop/src/preload/ipc.ts): backend/preload/frontend 경계, TypeScript·React 구성, pnpm 개발 명령을 참고했습니다. 참조 checkout의 기존 변경은 보존했습니다.
- Cropper `7ece8bd8f605393febea4e849608f25664dc8bd8`의 [캡처 저장](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/src/main/capture/index.ts), [metadata 검증](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/src/main/capture/history/metadata.ts), [IPC 보안](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/src/main/window-security.ts), [Playwright 검증](https://github.com/blahaj94/dfragon-cropper/blob/7ece8bd8f605393febea4e849608f25664dc8bd8/tests/ui/history-preview.spec.ts): 실제 캡처 계약, 제한된 로컬 파일 접근, 독립 fixture 검증을 참고했습니다.

별도 소형 앱에 필요한 범위만 적용했습니다. LDB의 monorepo UI 패키지 대신 React와 일반 CSS를 사용하고, ldb-ocr의 모델 로딩·전처리·디코딩·평가 코드는 복제하지 않고 선택한 소스에서 불러옵니다.

ldb-ocr 소스 스냅샷의 주요 재사용 지점은 `training/checkpoint.py`의 `load_trained_checkpoint`, `training/preprocessing.py`의 `tensor_from_png`, `training/evaluation.py`의 `character_classes`·`decode_output`, `recognition/metrics.py`의 `recognition_metrics`, `recognition/distance.py`의 `edit_distance`입니다. 경로와 해시는 로컬 보고서에 남으며 모델 파일이나 실제 이미지를 보고서 폴더로 복사하지 않습니다.
