# 그리기 화면 플로팅 도구 에셋

> 준비일: 2026-08-30
> 디자인 기준: `drawing-studio-selected-reference.png`

## 런타임 이미지

도구 이미지는 오른쪽 세로 팔레트의 `56×22 CSS px` 슬롯에서 `object-fit: contain`으로 표시한다.
각 에셋은 투명 PNG이며 `1x`, `2x`, `3x`를 제공한다.

| 도구 | 경로 | 3x 크기 | 용도 |
| --- | --- | --- | --- |
| 연필 | `/drawing-tools/pencil.png` | 168×67 | `pencil` |
| 크레용 | `/drawing-tools/crayon.png` | 168×67 | `crayon` |
| 마커 | `/drawing-tools/marker.png` | 168×46 | `marker` |
| 수채붓 | `/drawing-tools/watercolor.png` | 168×67 | `watercolor` |

전체 매핑과 `srcSet` 문자열은 `public/drawing-tools/manifest.json`에 있다. 고해상도 생성 원본은
`source/`에 보존하며 앱에서 직접 불러오지 않는다.

## 기존 자산 재사용

- 헤더 브랜드: `/brand/logo.png`
- 앱 아이콘이 필요한 경우: `/brand/app_icon.png`
- 씨앗 선 미리보기: 레슨의 실제 `seed` 좌표를 캔버스에 렌더링한다. 별도 그림 파일을 만들지 않는다.

## 아이콘 계약

아래 항목은 비트맵 에셋이 아니라 동일한 선 굵기의 아이콘 컴포넌트로 구현한다. 현재 저장소에는
아이콘 패키지가 없으므로 화면 구현 때 `lucide-react`를 추가하고 다음 이름을 사용한다.

| 기능 | Lucide 아이콘 |
| --- | --- |
| 뒤로 | `ArrowLeft` |
| 저장됨 | `Check` |
| 되돌리기 / 다시하기 | `Undo2` / `Redo2` |
| 지우개 | `Eraser` |
| 더보기 | `MoreHorizontal` |
| 음성 안내 | `Volume2` |
| 안내 접기 | `ChevronUp` |
| 선생님 말씀 | `MessageSquare` |
| 그림 부르기 | `Sparkles` |
| 플로팅 바 이동 손잡이 | `GripHorizontal` |

아이콘은 장식 이미지로 쓰지 않고 버튼의 `aria-label`과 함께 사용한다. 이모지는 도구 아이콘으로 쓰지 않는다.

## 이미지가 필요하지 않은 UI

- 펜 굵기: 선택된 펜을 다시 누르면 펜 왼쪽에 드래그 슬라이더가 열린다. 트랙, 손잡이, 굵기 미리보기는
  HTML/CSS UI이며 이미지 에셋이 아니다.
- 색상: 원형 swatch와 선택 링은 CSS UI다. 색 이름은 기존 `COLOR_NAMES`를 사용한다.
- 플로팅 안내 바: 흰 반투명 표면, 그림자, 버튼, 접기 상태는 UI 컴포넌트다.
- 패널의 유리 질감과 그림자는 CSS 토큰으로 만든다.

## 생성 방식과 프롬프트

네 도구는 Codex의 내장 ImageGen으로 생성했다. 첫 번째 참고 이미지는 Freeform식 실제 도구 모양,
선택된 Wiggle 시안은 크기와 배치 기준으로 사용했다. 공통 프롬프트는 다음 계약을 지켰다.

```text
Create one production UI asset only for Wiggle's narrow floating drawing toolbar.
Genuine transparent alpha, wide horizontal composition, tool pointing left.
Realistic-but-clean Apple Freeform-style physical tool sample, crisp silhouette,
subtle material texture, no external drop shadow. No UI, button, label, text, hand,
drawing, or scene. Remain recognizable at 56×22 CSS pixels.
```

도구별 차이는 연필(흰 몸통과 나무/흑연 촉), 빨간 크레용, 파란 마커, 갈색 털·은색 페룰·흰 손잡이의
수채붓이다. 생성 결과는 투명 채널을 확인한 뒤 `sips`로 1x/2x/3x에 축소했다.

## 검수 기준

- PNG의 `hasAlpha`가 `yes`인지 확인한다.
- 3x 파일을 원본 크기로 열어 외곽의 흰 배경·체크무늬·잘림이 없는지 확인한다.
- 실제 구현에서는 56×22px와 44px 이상의 버튼 hit area를 분리한다.
- 선택 표시는 이미지에 합성하지 않고 버튼의 청록색 세로선과 focus/pressed 상태로 제공한다.
