# 자료실 모델로 학습하고 평가하기

미니PC의 `ocr.dfragon.com`이 모델 파일과 OCR 데이터를 보관합니다. Windows 앱은 로그인 후 REST API로 선택한 모델·데이터를 가져와 이 PC의 GPU로 학습하고 평가합니다. 사용자가 **미니PC에 올리기**를 누르면 새 모델과 평가 요약을 등록합니다.

## 사용 순서

1. 모델 보관 API가 포함된 dfragon OCR 서버를 먼저 배포합니다. 웹의 **학습 모델 → 기본 한국어 PP-OCRv5 모델 추가**로 첫 모델을 등록합니다. 공식 학습 가중치와 문자 사전을 미니PC에 보관하며, 기존 모델을 덮어쓰지 않습니다.
2. 자료실에서 정답·제외 여부·train/val/test를 배정합니다. 같은 닉네임은 같은 분할을 사용합니다.
3. Windows 앱의 **학습** 탭에서 **자료실 로그인**을 누르고 기존 패스키로 로그인합니다. 시작 모델과 실험 저장 폴더를 선택해 **모델·데이터 가져오기**를 누릅니다.
4. 앱은 목록 조회 시점의 정답·분할과 선택한 이미지·모델을 새 `experiment-UUID` 폴더에 저장합니다. 정답 완료·미제외·배정된 샘플만 사용하며 나머지 개수를 표시합니다. 세 분할에 각각 한 개 이상의 샘플이 필요합니다.
5. **학습 실행 환경**에서 GPU Python과 PaddleOCR 소스를 선택합니다. 기존 평가 설정의 학습 환경이 있으면 초기값으로 사용합니다. 학습 횟수·배치 크기·학습률을 확인하고 **학습 후 test 평가**를 누릅니다.
6. train 전체로 학습하고 매 epoch마다 val을 평가합니다. CER가 가장 낮은 가중치를 선택하며, 같으면 Exact Match가 높은 가중치를 선택합니다. 둘 다 같으면 먼저 저장한 것을 유지합니다. 선택한 가중치를 다시 불러와 test를 한 번 평가합니다.
7. CER·Exact Match·정답과 예측·오답 이미지를 확인합니다. 이름을 입력하고 **미니PC에 올리기**를 누르면 가중치·사전·평가 요약이 새 모델 ID로 등록됩니다. 다음 학습의 시작 모델로 선택할 수 있습니다.

학습 중 취소는 현재 GPU 연산 뒤에 반영됩니다. 취소·실패 결과에 최종 성적을 표시하지 않습니다. 다운로드와 학습 파일은 지우지 않습니다. 새로운 학습 실행은 항상 새로운 `runs/UUID` 폴더를 사용합니다.

**저장한 실험·결과 열기**에서 실험 폴더를 선택하면 같은 입력으로 새 학습을 시작할 수 있습니다. 완료된 `runs/UUID`를 선택하면 앱 재시작 후에도 성적·이미지를 확인하고 등록할 수 있습니다. 등록 응답이 끊겼다면 같은 이름으로 다시 시도하세요. 저장된 등록 ID를 재사용하므로 중복 모델을 만들거나 기존 모델을 덮어쓰지 않습니다. 중단된 epoch부터 재개하거나 평가만 재실행하는 기능은 이번 버전에 포함하지 않습니다.

## 지원 모델과 실행 환경

첫 지원 모델은 [공식 Korean PP-OCRv5 mobile recognition](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/text_recognition.en.md)입니다. 임의의 학습 저장소 URL이나 실행 명령을 웹에서 등록하는 기능은 없습니다. 웹은 실제 모델 파일을 보관합니다.

- Windows x64, NVIDIA CUDA GPU, Python 3.12, PATH에서 실행되는 Git.
- 검증한 GPU 환경: PaddlePaddle GPU 3.2.2, NumPy 2.2.6, Pillow 11.3.0, PyYAML 6.0.3, OpenCV 4.11.0.86, Albumentations 2.0.8. PaddleOCR의 나머지 학습 의존성도 설치된 기존 환경을 사용합니다. 일반 Python만으로 실행할 수 없습니다.
- PaddleOCR 소스는 `b03f46425e8ff4442b268ce449e3eef758146cd4`로 고정하며 tracked 파일이 수정된 checkout은 거절합니다. 소스와 GPU 환경을 앱이 자동 설치하지 않습니다.
- 공식 한국어 설정의 MultiHead·MultiLoss, Adam, seed 42, gradient clipping 5를 사용합니다. 기본값은 10 epochs, batch 8, learning rate 0.00001입니다.
- 전처리는 공식 Eval 변환인 BGR·resize/padding `[3,48,320]`을 학습과 평가에 함께 사용합니다. 기본 버전에는 데이터 증강이 없습니다. 기존 평가 탭의 ldb-ocr custom 전처리와 다른 실행 경로입니다.
- 사전의 순서와 가중치의 모든 parameter 이름·shape가 일치해야 합니다. 사전에 없는 문자, 25자를 넘는 정답, 투명 PNG는 임의로 고치거나 건너뛰지 않고 거절합니다.

## 고정 입력과 결과

| 파일                                      | 내용                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `source-manifest.json`                    | 내려받은 시점의 서버 메타데이터 원문                             |
| `dataset.json`, `images/`                 | 선택한 정답·split·이미지 SHA-256·크롭 PNG                        |
| `model/`                                  | 시작 모델의 메타데이터·가중치·사전                               |
| `ready.json`                              | 다운로드 완료 표시와 dataset 해시                                |
| `runs/UUID/request.json`, `progress.json` | 실행 설정, epoch별 val 성적과 선택 epoch                         |
| `runs/UUID/weights.pdparams`              | val로 선택한 가중치                                              |
| `runs/UUID/report.json`                   | 모든 test 샘플과 성적·실행 환경·코드/가중치 해시                 |
| `runs/UUID/evaluation.json`               | 미니PC에 올리는 요약. 로컬 경로·정답 이미지 원문은 포함하지 않음 |
| `runs/UUID/publish.json`                  | 수동 등록 재시도에 사용하는 동일 ID·이름                         |

모델 파일과 이미지 해시를 검사하고, 학습 중 이미지를 읽을 때도 해시를 재검사합니다. 같은 NFC 닉네임 또는 같은 디코딩 픽셀이 서로 다른 분할에 있으면 중단합니다. 서로 다른 닉네임이 한 캡처에 있다는 이유로 재배정하지 않습니다. 이러한 캡처 혼재는 경고하고 자료실 배정을 유지합니다. 기존 Dataset 탭의 캡처 단위 분할과 구분됩니다.

동일한 test 이미지·정답으로 생성한 완료 보고서 두 개는 기존 **결과 비교** 탭에서 비교할 수 있습니다. test 성적은 epoch 선택에 사용하지 않습니다. 새 자료를 가져오면 새 실험을 생성합니다. 실험 폴더를 옮기면 보고서의 이미지 절대 경로가 바뀌므로 이번 버전은 원래 위치에서 다시 여는 방식을 지원합니다.

## API와 인증

앱 main이 고정 HTTPS 주소와 임시 Electron 세션을 소유합니다. 로그인 창에는 Node 권한과 앱 preload가 없으며 OCR 자료실과 기존 인증 서버의 로그인 경로만 허용합니다. renderer는 토큰·임의 요청 URL을 전달하지 않습니다. 로그인은 앱을 종료하면 유지되지 않습니다.

앱은 owner cookie로 `GET /api/models`, `GET /api/models/:id`, `GET /api/models/:id/files/:name`, `GET /api/export/manifest`, `GET /api/samples/:id/image`를 호출합니다. 수동 등록은 정확한 Origin을 붙인 `POST /api/models` multipart입니다. 서버는 별도로 동일 모델 계약의 Origin 없는 기존 owner Bearer `/api/desktop/models` 경로도 제공합니다. 모델 파일은 합계 128 MiB 이하이며 이름은 `weights.pdparams`, `characters.txt`, `evaluation.json`으로 제한합니다. 등록 파일 해시를 응답과 다시 비교합니다.

## 검증과 한계

합성 PNG와 공식 가중치로 RTX 3080 Ti에서 1 epoch, train 3·val 1·test 1, optimizer 2 steps를 실행해 가중치 저장·재로딩·최종 test 보고서 생성을 확인했습니다. 이는 연결 검증이며 실데이터 정확도나 성능 개선의 증거가 아닙니다. 실제 운영 패스키 로그인·다운로드·미니PC 등록은 서버 배포 후 별도 확인이 필요합니다.

CER·편집거리 코드는 ldb-ocr의 순수 계산 모듈에서 가져왔습니다. 원저작자는 blahaj94 및 LDB 기여자이며 원 출처는 [LDB PR #500](https://github.com/blahaj94/ldb/pull/500)입니다. 별도 라이선스를 임의로 부여하지 않습니다. 모델·PaddleOCR 소스·GPU 가상환경·실제 정답 데이터는 앱 배포 파일과 Git에 포함하지 않습니다.
