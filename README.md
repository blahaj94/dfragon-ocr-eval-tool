<p align="center">
  <img src="resources/icon.png" width="88" alt="DFRAGON 빨간 용" />
</p>

<h1 align="center">Real OCR Evaluation</h1>

<p align="center">
  체크포인트와 실제 이미지를 선택해 <strong>OCR 정확도와 오답을 확인하는 Windows GPU 앱</strong>입니다.
</p>

<p align="center">
  <a href="docs/guide.md">실행 안내</a> · <a href="examples/labels.json">labels.json 예제</a>
</p>

## 01. 모델과 데이터 선택

<p align="center">
  <img src="docs/screenshots/setup.png" width="352" alt="실제 앱에서 Python, 학습 결과, 체크포인트, Cropper 캡처와 정답 파일을 선택한 화면" />
</p>

## 02. 평가 실행 → 정확도와 오답 확인

<sub>실제 Windows 앱에서 합성 예제 이미지 3개를 GPU로 평가했습니다. 수치는 사용법 시연용입니다.</sub>

![CER와 Exact Match, 정답·예측·편집거리, 실행별 보고서를 보여주는 실제 평가 결과](docs/screenshots/results.png)

## 03. 이미지를 확대해 비교

![ROI 이미지를 확대해 정답과 예측을 비교하는 실제 앱 화면](docs/screenshots/zoom.png)
