# Wiggle 홈페이지 아이콘 시안

2026-09-12 사용자 요청으로 만든 신규 시안. 기존 운영 로고와 파비콘을 교체하지 않았다.

- 노란 오리 몽그리의 얼굴과 파란 베레모를 단순한 도형으로 재해석했다.
- 초록 바탕은 이미지 전체에 포함된 불투명 배경이다.
- `wiggle-icon-source.png`: 생성 원본.
- `wiggle-icon-512.png`, `wiggle-icon-192.png`: 웹 아이콘용 크기.
- `apple-touch-icon.png`: 180×180.
- `favicon-48.png`, `favicon-32.png`: 작은 브라우저 아이콘 후보.
- 글자가 없는 심벌이므로 홈페이지에서는 별도 HTML의 Wiggle 워드마크 옆에 사용할 수 있다.
- 이미지 자체에 둥근 모서리를 구워 넣지 않는다. 웹 UI에서 필요한 경우 CSS border-radius로 조절한다.
- 작은 파비콘은 일부 표정 디테일이 줄어든다. 원본을 늘려 쓰지 말고 사용 크기에 맞는 파일을 고른다.
- 내장 ImageGen으로 생성. 참고: `docs/design-assets/number-keypad/assets/mongri-keypad-ivory.png`. 프롬프트는 `prompt.txt`에 보관한다.
- PNG 크기 변환은 sharp로 수행한다. 앱 통합 및 운영 배포는 하지 않았다.
