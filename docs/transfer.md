# Cropper 정답을 labels.json으로 변환

Cropper의 **Ground Truth** 탭에서 저장한 정답을 평가용 목록으로 옮깁니다. PNG와 `metadata.json`, `.bak`는 변경하지 않습니다. OCR·GPU·추가 Python 패키지를 사용하지 않습니다.

## 사용

Python 3.10 이상이 설치된 Windows에서 `captures` 폴더를 저장소 루트의 **transfer.cmd**에 끌어 놓으세요. `python` 폴더도 함께 있어야 합니다.

명령으로 실행하려면 저장소 루트에서:

```powershell
py -3 python/transfer.py "D:\captures"
```

`D:\captures\labels.json`이 생성됩니다. 평가 앱에서 같은 **캡처 루트**와 생성된 **정답 파일**을 선택하세요. 출력에는 이벤트 수(`events`), 내보낸 ROI 수(`samples`), 정답 미등록 ROI 수(`unanswered`)가 표시됩니다.

기존 파일은 덮어쓰지 않습니다. 정답을 추가한 뒤 새 목록을 만들려면:

```powershell
py -3 python/transfer.py "D:\captures" --output "D:\labels-new.json"
```

## 변환 규칙

- 각 이벤트의 현재 `metadata.json`에서 `groundTruth.schemaVersion: 1`과 `groundTruth.regions`를 읽습니다. `.bak`는 사용하지 않습니다.
- `regions`의 ROI ID로 정답과 PNG를 연결합니다. 출력 `id`는 `이벤트ID/ROI번호`, `image`는 `이벤트ID/ROI번호.png`입니다.
- 정답 문자열의 공백과 Unicode를 그대로 보존합니다. Cropper에서 미작성으로 취급하는 필드 누락·`null`·빈 문자열·공백만 있는 값은 미등록 개수로 알리고 내보내지 않습니다.
- 잘못된 형식, 알 수 없는 ROI, 등록된 이미지 누락·잘못된 PNG 헤더·크기 불일치는 전체 변환을 실패시킵니다. 기존 평가 로더의 경로·metadata·PNG 헤더 검사를 재사용하며, 모델 입력 가능 여부나 PNG 전체 디코딩을 이 단계에서 보증하지 않습니다.
- 정답이 하나도 없으면 파일을 만들지 않습니다. 먼저 Cropper에서 정답을 저장하세요.

이미지·정답·모델을 자동 생성하거나 수정하는 기능은 없습니다. 평가 앱 자체를 재설치하지 않고 변환된 목록을 사용할 수 있습니다.

Cropper의 [정답 저장 형식](https://github.com/blahaj94/dfragon-cropper/blob/main/docs/ground-truth.md)과 현재 `readAnswers` 구현을 기준으로 변환합니다. Python 테스트 80개 및 실제 Windows에서 CMD 실행·정답 변환·평가 로더 읽기·기존 파일 덮어쓰기 거부를 확인했습니다. GPU 추론은 실행하지 않았습니다.
