# Biker Project Roadmap

## 1. 프로젝트 마일스톤 (Milestones)
- [x] 카카오 지도 렌더링 및 GPS 실시간 추적 연동
- [x] BRouter 스쿠터 전용 숏컷 탐색 엔진 도입 (자동차 전용도로 우회)
- [x] 즐겨찾기(Favorites) 기능 및 UI 포커스 인식 개선
- [x] 화면 꺼짐 방지(WakeLock) 모드 도입
- [x] 실시간 경로 이탈 자동 재탐색(Auto-Rerouting) 기능 탑재
- [x] BRouter 불법 U턴 한계 극복을 위한 자체 수학적 스캔 레이더 탑재
- [ ] 정밀한 음성 턴바이턴(TBT) 안내 구현 (향후 T맵 API 키 확보 시 전환 가능성)

## 2. 공용 아키텍처 및 재사용 자산 명세

### [이미 구현 완료된 공용 자산 (Implemented Assets)]
- **BRouter API 통신 유틸리티**: `fetchBRouterMopedRoute` (GeoJSON 파싱 및 시간/거리 계산)
- **위치 기반 수학 스캐너**: `detectAndMarkUTurns` (내적과 아크코사인을 이용한 150도 이상 U턴 곡선 벡터 감지 로직)
- **경로 이탈 감지 유틸리티**: `getDistanceToPath` (현재 GPS 위치와 다각형 선분 사이의 최단 거리를 미터 단위로 계산하는 투영 알고리즘)

### [구현 예정인 공용 자산 (Planned Assets)]
- T맵 연동 기반의 공식 이륜차 엔진 및 TTS 텍스트 분리기
