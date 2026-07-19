# 변경 이력 (Changelog)

이 프로젝트의 버전별 주요 변경 사항.
[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르고,
버전은 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 따른다.

## [Unreleased]
- (다음 릴리즈에 들어갈 변경을 여기 쌓아둔다)

## [1.0.0] - 2026-07-16
첫 릴리즈. 노트북(Windows / Electron) 상주 앱.

### 추가 (Added)
- 주요 업무 보관함 → 4블록(아침·점심·저녁·밤) 배치, 블록별 체크리스트
- 하루 상태 기록
  - 단어 모드: 해냄·즐거움·그럭저럭·가라앉음·무너짐 (5단계)
  - 1~5 척도 모드 (설정에서 토글, 단어 ↔ 점수 연동)
- 지난 2주 흐름 색 막대 + "오늘 남은 핵심" 요약
- Electron 껍데기: frameless·항상 위·트레이 토글·투명도·자동 실행 토글
- 로컬 JSON 파일 저장(원자적 쓰기), 저장 폴더 선택, JSON 내보내기/가져오기
- 구 localStorage(`harukyul.v2`) → JSON 1회 자동 마이그레이션

### 참고
- `renderer/index.html`이 정본. `하루결.html`은 원본(동결, 폰 PWA용 참조).
