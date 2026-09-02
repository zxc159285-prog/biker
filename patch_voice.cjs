const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf8');

// 1. 방위각 계산 및 BRouter 가이드 생성 함수 추가 (상단 import 근처)
const helperCode = `
// [추가] 두 좌표 사이의 방위각(Bearing) 계산 함수
const getBearing = (lat1, lng1, lat2, lng2) => {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const dLng = (lng2 - lng1) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLng);
  const brng = Math.atan2(y, x) * toDeg;
  return (brng + 360) % 360;
};

// [추가] BRouter 좌표 기반으로 회전(우회전/좌회전) 가이드 생성
const generateBRouterGuides = (coords) => {
  const guides = [];
  let lastBearing = null;
  // 너무 짧은 구간의 노이즈(곡선)를 무시하기 위해 3칸씩 건너뛰며 검사
  for (let i = 0; i < coords.length - 2; i += 3) {
    const p1 = coords[i];
    const p2 = coords[Math.min(i + 3, coords.length - 1)];
    const bearing = getBearing(p1[1], p1[0], p2[1], p2[0]);
    if (lastBearing !== null) {
      let diff = bearing - lastBearing;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      // 40도 이상 꺾일 때만 유효한 회전으로 인식 (노이즈 캔슬링)
      if (Math.abs(diff) > 40 && Math.abs(diff) < 140) {
        const turnStr = diff > 0 ? "우측 골목길 숏컷" : "좌측 골목길 숏컷";
        guides.push({
          text: \`전방 50미터 앞, \${turnStr}으로 진입하세요.\`,
          lat: p2[1],
          lng: p2[0],
          alerted: false,
          type: 'brouter'
        });
      }
    }
    lastBearing = bearing;
  }
  return guides;
};
`;

if (!code.includes('generateBRouterGuides')) {
  // App 함수 바깥이나 안쪽에 넣기 좋게 CSS import 아래쯤에 넣습니다.
  code = code.replace(/import '\.\/App\.css';/, "import './App.css';" + helperCode);
}

// 2. 가이드 상태 Ref 추가
if (!code.includes('brouterGuidesRef')) {
  code = code.replace(/const uTurnMarkersRef = useRef\(\[\]\);/, 
  `const uTurnMarkersRef = useRef([]);
  const brouterGuidesRef = useRef([]);
  const kakaoGuidesRef = useRef([]);`);
}

// 3. fetchBRouterMopedRoute 함수 업데이트 (가이드 반환 추가)
code = code.replace(
  /const steps = \[\s*\{ arrow: '.*?', text: '.*?', distance: distance, alertBadgeText: '.*?' \},\s*\{ arrow: '.*?', text: '.*?', distance: 0 \}\s*\];\s*return \{ path: linePath, distance, duration, steps \};/s,
  `const steps = [
              { arrow: '🚀', text: '오토바이 전용 극한 숏컷 진입 (역주행/계단/자전거도로 원천 차단됨)', distance: distance, alertBadgeText: '골목길 우회 활성화' },
              { arrow: '🏁', text: '목적지 부근에 도착했습니다.', distance: 0 }
            ];
            const guides = generateBRouterGuides(coords);
            return { path: linePath, distance, duration, steps, guides };`
);

// 4. fetchKakaoNaviRoute 함수 업데이트 (가이드 파싱 추가)
code = code.replace(
  /const distance = route\.summary\.distance \|\| 0;\s*const duration = route\.summary\.duration \|\| 0;\s*return \{ path, distance, duration \};/s,
  `const distance = route.summary.distance || 0;
            const duration = route.summary.duration || 0;
            
            const kakaoGuides = [];
            if (route.sections[0].guides) {
              route.sections[0].guides.forEach(g => {
                if (g.guidance) {
                  kakaoGuides.push({
                    text: \`안전 경로 \${g.guidance}\`, // 카카오 원본 데이터에 안전경로 접두사 추가
                    lat: g.y,
                    lng: g.x,
                    alerted: false,
                    type: 'kakao'
                  });
                }
              });
            }
            return { path, distance, duration, guides: kakaoGuides };`
);

// 5. handleAutoReroute와 route초기화 부분에서 Ref 업데이트
// 정규식으로 routePathRef.current = brouterResult.path; 아래에 가이드 저장을 주입합니다.
code = code.replace(
  /routePathRef\.current = brouterResult\.path;/g,
  `routePathRef.current = brouterResult.path;
        brouterGuidesRef.current = brouterResult.guides || [];`
);
code = code.replace(
  /routePathKakaoRef\.current = kakaoResult && kakaoResult\.path \? kakaoResult\.path : \[\];/g,
  `routePathKakaoRef.current = kakaoResult && kakaoResult.path ? kakaoResult.path : [];
        kakaoGuidesRef.current = kakaoResult && kakaoResult.guides ? kakaoResult.guides : [];`
);

// 6. watchPosition 내부에 다이내믹 스위칭 음성 출력부 추가
const voiceSwitchingLogic = `
            const minDistance = Math.min(distBRouter, distKakao);
            
            // [다이내믹 보이스 스위칭 로직]
            const activeRoute = distBRouter <= distKakao ? 'brouter' : 'kakao';
            const currentGuides = activeRoute === 'brouter' ? brouterGuidesRef.current : kakaoGuidesRef.current;
            
            if (currentGuides && currentGuides.length > 0) {
              currentGuides.forEach(guide => {
                if (!guide.alerted) {
                  const d = getDistanceToPath(lat, lng, [new window.kakao.maps.LatLng(guide.lat, guide.lng)]);
                  if (d < 50) { // 50m 전방에서 다가올 때
                    guide.alerted = true; // 중복 송출 방지
                    speakVoiceGuide(guide.text);
                  }
                }
              });
            }
`;
code = code.replace(
  /const minDistance = Math\.min\(distBRouter, distKakao\);/g,
  voiceSwitchingLogic
);

fs.writeFileSync('src/App.jsx', code, 'utf8');
console.log('PATCH_SUCCESS');
