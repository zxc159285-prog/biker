import { useEffect, useRef, useState } from 'react';
import './App.css';
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
          text: `전방 50미터 앞, ${turnStr}으로 진입하세요.`,
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


// 경로와 특정 좌표 간 최단거리 (기존)
function getDistanceToPath(lat, lng, path) {
  if (!path || path.length < 2) return 0;
  let minDist = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i], p2 = path[i + 1];
    const x0 = lng, y0 = lat;
    const x1 = p1.getLng(), y1 = p1.getLat();
    const x2 = p2.getLng(), y2 = p2.getLat();
    const dx = (x2 - x1) * cosLat, dy = (y2 - y1);
    const l2 = dx * dx + dy * dy;
    let t = 0;
    if (l2 !== 0) {
      const vx = (x0 - x1) * cosLat, vy = (y0 - y1);
      t = Math.max(0, Math.min(1, (vx * dx + vy * dy) / l2));
    }
    const projX = x1 + t * (x2 - x1), projY = y1 + t * (y2 - y1);
    const dist = Math.sqrt(Math.pow((x0 - projX) * cosLat * 111000, 2) + Math.pow((y0 - projY) * 111000, 2));
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

// 두 좌표(위경도) 간의 직선 거리 반환 (Haversine 공식 적용, 단위: 미터)
function getPointDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const myLocationMarkerRef = useRef(null);
  const myLocationDOMRef = useRef(null);
  const startLocationMarkerRef = useRef(null);
  const destinationMarkerRef = useRef(null);
  const polylineRef = useRef(null);
  const polylineKakaoRef = useRef(null);
  const uTurnMarkersRef = useRef([]);
  const brouterGuidesRef = useRef([]);
  const kakaoGuidesRef = useRef([]);

  const watchIdRef = useRef(null);
  const wakeLockRef = useRef(null);
  const currentPosRef = useRef(null);
  const lastHeadingRef = useRef(0);

  const isNavigatingRef = useRef(false);
  const routePathRef = useRef([]);
  const routePathKakaoRef = useRef([]);
  const isReroutingRef = useRef(false);
  const selectedDestRef = useRef(null);

  // 카메라 음성 안내를 위한 메모리 Ref
  const visibleSafemapDataRef = useRef([]); // 화면에 그려진 카메라 좌표 저장
  const announcedCamerasRef = useRef(new Set()); // 이미 안내한 카메라 ID 기록 (중복 안내 방지)

  const [selectedStart, setSelectedStart] = useState({ placeName: '내 위치', lat: null, lng: null });
  const [selectedDest, setSelectedDest] = useState(null);
  const [startQuery, setStartQuery] = useState('내 위치');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [startResults, setStartResults] = useState([]);
  const [destResults, setDestResults] = useState([]);
  
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('biker_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const [routeInfo, setRouteInfo] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [instructions, setInstructions] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [activeInput, setActiveInput] = useState('dest');

  const [safemapData, setSafemapData] = useState([]);
  const [routeTrigger, setRouteTrigger] = useState(0); 
  const renderedMarkersRef = useRef([]);

  useEffect(() => { selectedDestRef.current = selectedDest; }, [selectedDest]);
  useEffect(() => { isNavigatingRef.current = isNavigating; }, [isNavigating]);

  useEffect(() => {
    fetch('/safemap_data.json')
      .then(res => res.json())
      .then(data => setSafemapData(data))
      .catch(err => console.error("데이터 로드 실패", err));
  }, []);

  useEffect(() => {
    if (!mapRef.current || !window.kakao || safemapData.length === 0) return;

    const updateMarkers = () => {
      renderedMarkersRef.current.forEach(m => m.setMap(null));
      renderedMarkersRef.current = [];

      const currentPath = routePathRef.current;
      const hasRoute = currentPath && currentPath.length > 0;
      const bounds = mapRef.current.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();

      const visibleData = safemapData.filter(d => {
        if (d.lat < sw.getLat() || d.lat > ne.getLat() || d.lng < sw.getLng() || d.lng > ne.getLng()) return false;
        if (d.type === 'parking') return true;
        if (hasRoute || (routePathKakaoRef.current && routePathKakaoRef.current.length > 0)) {
          const distBRouter = hasRoute ? getDistanceToPath(d.lat, d.lng, currentPath) : Infinity;
          const distKakao = (routePathKakaoRef.current && routePathKakaoRef.current.length > 0) ? getDistanceToPath(d.lat, d.lng, routePathKakaoRef.current) : Infinity;
          const minDist = Math.min(distBRouter, distKakao);

          if (d.type === 'camera' || d.type === 'rear_camera') {
            return minDist <= 30;
          } else if (d.type === 'schoolzone') {
            return minDist <= 50;
          }
        }
        return false;
      });

      const newMarkersData = visibleData.slice(0, 300);
      visibleSafemapDataRef.current = newMarkersData; // 음성 안내 대상에 저장

      const newMarkers = newMarkersData.map(d => {
        let content = '';
        if (d.type === 'camera') {
          content = `<div style="background:#fff; border:3px solid #ff3344; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:900; color:#ff3344; font-size:14px; box-shadow:0 2px 4px rgba(0,0,0,0.3); opacity: 0.9;">
            ${d.speed > 0 ? d.speed : '📷'}
          </div>`;
        } else if (d.type === 'rear_camera') {
          content = `<div style="background:#ff3344; border:3px solid #fff; width:44px; height:44px; border-radius:10px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:900; color:#fff; box-shadow:0 4px 6px rgba(0,0,0,0.5); z-index: 99;">
            <span style="font-size:10px; line-height:1;">후면</span>
            <span style="font-size:16px; line-height:1.1;">${d.speed > 0 ? d.speed : '🚨'}</span>
          </div>`;
        } else if (d.type === 'schoolzone') {
          content = `<div style="background:#fbbf24; border:2px solid #fff; padding:4px 8px; border-radius:12px; font-weight:800; color:#b45309; font-size:12px; box-shadow:0 2px 4px rgba(0,0,0,0.3); opacity: 0.85;">
            🚸 30
          </div>`;
        } else if (d.type === 'parking') {
          content = `<div style="background:#ef4444; border:2px solid #fff; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:900; color:#fff; font-size:12px; box-shadow:0 2px 4px rgba(0,0,0,0.3); opacity: 0.7;">
            P
          </div>`;
        }

        const overlay = new window.kakao.maps.CustomOverlay({
          position: new window.kakao.maps.LatLng(d.lat, d.lng),
          content: content,
          zIndex: d.type === 'rear_camera' ? 100 : 50
        });
        overlay.setMap(mapRef.current);
        return overlay;
      });
      renderedMarkersRef.current = newMarkers;
    };

    updateMarkers();
    window.kakao.maps.event.addListener(mapRef.current, 'idle', updateMarkers);
    return () => window.kakao.maps.event.removeListener(mapRef.current, 'idle', updateMarkers);
  }, [safemapData, routeTrigger]);

  const requestScreenWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } 
      catch (err) { console.log('화면 켜짐 유지 거부:', err); }
    }
  };

  const releaseScreenWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => { wakeLockRef.current = null; });
    }
  };

  const speakVoiceGuide = (text) => {
    if (!isVoiceEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  const updateMyLocationMarker = (lat, lng, heading) => {
    const currentLatLng = new window.kakao.maps.LatLng(lat, lng);
    if (heading !== null && !isNaN(heading)) lastHeadingRef.current = heading;
    const rotation = lastHeadingRef.current;

    if (!myLocationMarkerRef.current) {
      const el = document.createElement('div');
      el.style.width = '36px';
      el.style.height = '36px';
      el.style.backgroundColor = 'rgba(255, 51, 68, 0.2)';
      el.style.borderRadius = '50%';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.border = '2px solid #FF3344';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      el.style.transition = 'transform 0.4s ease-out';
      
      const arrow = document.createElement('div');
      arrow.style.width = '0';
      arrow.style.height = '0';
      arrow.style.borderLeft = '8px solid transparent';
      arrow.style.borderRight = '8px solid transparent';
      arrow.style.borderBottom = '16px solid #FF3344';
      arrow.style.transform = 'translateY(-6px)';
      el.appendChild(arrow);
      
      myLocationDOMRef.current = el;

      myLocationMarkerRef.current = new window.kakao.maps.CustomOverlay({
        position: currentLatLng,
        content: el,
        zIndex: 1000
      });
      myLocationMarkerRef.current.setMap(mapRef.current);
    } else {
      myLocationMarkerRef.current.setPosition(currentLatLng);
    }
    
    if (myLocationDOMRef.current) {
      myLocationDOMRef.current.style.transform = `rotate(${rotation}deg)`;
    }
  };

  const handleAutoReroute = async (currentLat, currentLng, isSilent = false) => {
    if (!selectedDestRef.current || isReroutingRef.current) return;
    isReroutingRef.current = true;
    
    if (!isSilent) {
      speakVoiceGuide("경로를 이탈하여 재탐색합니다.");
    }
    
    // [경로 이탈 시에도 듀얼 라우팅 동시 재탐색]
    const [brouterResult, kakaoResult] = await Promise.all([
      fetchBRouterMopedRoute(currentLat, currentLng, selectedDestRef.current.lat, selectedDestRef.current.lng),
      fetchKakaoNaviRoute(currentLat, currentLng, selectedDestRef.current.lat, selectedDestRef.current.lng)
    ]);
    
    if (brouterResult && brouterResult.path.length > 0) {
      if (polylineRef.current) polylineRef.current.setMap(null);
      if (polylineKakaoRef.current) polylineKakaoRef.current.setMap(null);
      uTurnMarkersRef.current.forEach(marker => marker.setMap(null));
      uTurnMarkersRef.current = [];

      // 1. 카카오 안전 경로 (바닥)
      if (kakaoResult && kakaoResult.path && kakaoResult.path.length > 0) {
        const polylineKakao = new window.kakao.maps.Polyline({
          path: kakaoResult.path,
          strokeWeight: 8,
          strokeColor: '#3366FF',
          strokeOpacity: 0.8,
          strokeStyle: 'solid',
        });
        polylineKakao.setZIndex(1);
        polylineKakao.setMap(mapRef.current);
        polylineKakaoRef.current = polylineKakao;
      }

      // 2. BRouter 숏컷 경로 (위)
      const polyline = new window.kakao.maps.Polyline({
        path: brouterResult.path,
        strokeWeight: 4,
        strokeColor: '#FF3344',
        strokeOpacity: 1.0,
        strokeStyle: 'shortdash',
      });
      polyline.setZIndex(2);
      polyline.setMap(mapRef.current);
      polylineRef.current = polyline;

      uTurnMarkersRef.current = detectAndMarkUTurns(brouterResult.path, mapRef.current);
      routePathRef.current = brouterResult.path;
        brouterGuidesRef.current = brouterResult.guides || []; 
      routePathKakaoRef.current = kakaoResult && kakaoResult.path ? kakaoResult.path : [];
        kakaoGuidesRef.current = kakaoResult && kakaoResult.guides ? kakaoResult.guides : [];
      setRouteTrigger(p => p + 1);

      const distanceKm = (brouterResult.distance / 1000).toFixed(1);
      const estimatedMinutes = Math.max(1, Math.round(brouterResult.duration / 60));
      
      setRouteInfo(prev => ({
        ...prev,
        distance: distanceKm,
        time: estimatedMinutes,
      }));
    }
    setTimeout(() => { isReroutingRef.current = false; }, 3000); 
  };

  const startRealtimeTracking = () => {
    if (!navigator.geolocation) return;
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const heading = position.coords.heading;
        currentPosRef.current = { lat, lng };

        if (mapRef.current) {
          updateMyLocationMarker(lat, lng, heading);
          mapRef.current.panTo(new window.kakao.maps.LatLng(lat, lng));
        }

        if (isNavigatingRef.current && routePathRef.current.length > 0 && !isReroutingRef.current) {
          const distBRouter = getDistanceToPath(lat, lng, routePathRef.current);
          const distKakao = routePathKakaoRef.current.length > 0 ? getDistanceToPath(lat, lng, routePathKakaoRef.current) : Infinity;
          
          // 빨간 선과 파란 선 중 나와의 거리
          
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

          
          if (minDistance > 20) {
            // 1. 완전 이탈: 두 선 모두 20미터 밖으로 벗어남 -> 요란하게 하드 재탐색
            handleAutoReroute(lat, lng, false);
          } else {
            // 정상 주행 시 카메라 접근 체크 (반경 300m 이내)
            visibleSafemapDataRef.current.forEach(camera => {
              const dist = getPointDistance(lat, lng, camera.lat, camera.lng);
              if (dist <= 300) {
                const camId = `${camera.lat}_${camera.lng}`;
                // 중복 안내 방지
                if (!announcedCamerasRef.current.has(camId)) {
                  announcedCamerasRef.current.add(camId);
                  
                  // 거리에 들어오면 즉시 음성 안내
                  if (camera.type === 'schoolzone') {
                    speakVoiceGuide("전방 삼백미터 앞, 어린이 보호구역입니다. 서행하세요.");
                  } else if (camera.type === 'rear_camera') {
                    if (camera.speed > 0) speakVoiceGuide(`전방 삼백미터 앞, 시속 ${camera.speed}킬로미터, 후면 단속 구역입니다.`);
                    else speakVoiceGuide(`전방 삼백미터 앞, 후면 단속 카메라가 있습니다.`);
                  } else if (camera.type === 'camera') {
                    if (camera.speed > 0) speakVoiceGuide(`전방 삼백미터 앞, 시속 ${camera.speed}킬로미터, 단속 구간입니다.`);
                    else speakVoiceGuide(`전방 삼백미터 앞, 단속 카메라가 있습니다.`);
                  } else if (camera.type === 'parking') {
                    speakVoiceGuide("전방 삼백미터 앞, 불법 주정차 단속 구역입니다.");
                  }
                }
              }
            });
          }
        }
      },
      (error) => console.error('실시간 트래킹 에러:', error),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );
  };

  const fetchCurrentPositionSilent = (forcePanTo = false) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const heading = position.coords.heading;
        currentPosRef.current = { lat, lng };
        if (mapRef.current) {
          updateMyLocationMarker(lat, lng, heading);
          if (forcePanTo) mapRef.current.panTo(new window.kakao.maps.LatLng(lat, lng));
        }
      },
      (error) => console.error('GPS 실패:', error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const stopRealtimeTracking = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const searchPlaceList = (keyword, isStart) => {
    if (!keyword.trim() || keyword === '내 위치') {
      if (isStart) setStartResults([]);
      else setDestResults([]);
      return;
    }
    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) return;
    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(keyword, (data, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const list = data.slice(0, 5).map((item) => ({
          placeName: item.place_name,
          address: item.address_name,
          roadAddress: item.road_address_name || '',
          lat: parseFloat(item.y),
          lng: parseFloat(item.x),
        }));
        if (isStart) setStartResults(list);
        else setDestResults(list);
      } else {
        if (isStart) setStartResults([]);
        else setDestResults([]);
      }
    });
  };

  let cachedCustomProfileId = null;

  const getDynamicScooterProfile = async () => {
    if (cachedCustomProfileId) return cachedCustomProfileId;
    try {
      // 1. 깃허브에서 골목길 숏컷에 최적화된 fastbike 원본 소스코드 실시간 획득
      const res = await fetch('https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2/fastbike.brf');
      let text = await res.text();
      
      // 2. 역주행(reversedirection) 솜방망이 페널티 구역을 통째로 날려버리고 사형선고(10000)로 완벽 개조
      text = text.replace(/assign onewaypenalty =[\s\S]*?# Eventually compute traffic penalty/, 'assign onewaypenalty = if badoneway then 10000 else 0.0\n\n# Eventually compute traffic penalty');
      
      // 3. 자전거도로, 보행자도로, 계단 진입 시 10000점 페널티를 주도록 costfactor 연산 개조
      text = text.replace('assign costfactor\n', 'assign is_illegal = or highway=cycleway or highway=pedestrian highway=steps\nassign costfactor\n add switch is_illegal 10000 0\n');

      // 4. 개조된 수천 줄의 알고리즘을 프록시 터널을 통해 BRouter 해시 서버에 POST 업로드
      const uploadRes = await fetch('/brouter-proxy/brouter/profile', {
        method: 'POST',
        body: text
      });
      const uploadData = await uploadRes.json();
      
      if (uploadData.profileid) {
        cachedCustomProfileId = uploadData.profileid;
        return cachedCustomProfileId;
      }
    } catch (e) {
      console.error("커스텀 알고리즘 주입 실패 (moped로 대체):", e);
    }
    return 'moped'; // 실패 시 안전한 합법 기본값으로 폴백
  };

  const fetchBRouterMopedRoute = async (startLat, startLng, endLat, endLng) => {
    try {
      // 실시간으로 튜닝된 궁극의 해시 아이디(custom_xxx) 획득
      const profileId = await getDynamicScooterProfile();

      // 프록시 터널(/brouter-proxy)을 경유하여 해시 아이디로 GET 길찾기 요청
      const url = `/brouter-proxy/brouter?lonlats=${startLng},${startLat}|${endLng},${endLat}&profile=${profileId}&alternativeidx=0&format=geojson`;
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          const coords = feature.geometry.coordinates;
          const linePath = coords.map((c) => new window.kakao.maps.LatLng(c[1], c[0]));
          const distance = parseInt(feature.properties['track-length'] || 0, 10);
          const duration = parseInt(feature.properties['total-time'] || 0, 10);
          const steps = [
              { arrow: '🚀', text: '오토바이 전용 극한 숏컷 진입 (역주행/계단/자전거도로 원천 차단됨)', distance: distance, alertBadgeText: '골목길 우회 활성화' },
              { arrow: '🏁', text: '목적지 부근에 도착했습니다.', distance: 0 }
            ];
            const guides = generateBRouterGuides(coords);
            return { path: linePath, distance, duration, steps, guides };
        }
      }
    } catch (e) {
      console.error('BRouter 커스텀 탐색 실패:', e);
    }
    return null;
  };

  const detectAndMarkUTurns = (path, map) => {
    const markers = [];
    const step = 3; 
    for (let i = step; i < path.length - step; i++) {
      const prev = path[i - step], curr = path[i], next = path[i + step];
      const vIn = { x: curr.getLng() - prev.getLng(), y: curr.getLat() - prev.getLat() };
      const vOut = { x: next.getLng() - curr.getLng(), y: next.getLat() - curr.getLat() };
      const dot = vIn.x * vOut.x + vIn.y * vOut.y;
      const magIn = Math.sqrt(vIn.x * vIn.x + vIn.y * vIn.y);
      const magOut = Math.sqrt(vOut.x * vOut.x + vOut.y * vOut.y);
      if (magIn === 0 || magOut === 0) continue;
      const cosTheta = dot / (magIn * magOut);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);

      if (angle > 150) {
        const content = '<div style="background:#FF0000;color:#FFF;padding:4px 8px;border-radius:20px;font-size:12px;font-weight:900;border:2px solid #FFF;box-shadow:0 2px 4px rgba(0,0,0,0.3);transform:translateY(-100%);">🚨 불법U턴 주의</div>';
        const customOverlay = new window.kakao.maps.CustomOverlay({
          position: curr,
          content: content,
          zIndex: 999
        });
        customOverlay.setMap(map);
        markers.push(customOverlay);
        i += step * 2; 
      }
    }
    return markers;
  };

  const fetchKakaoNaviRoute = async (startLat, startLng, endLat, endLng) => {
    try {
      // 카카오내비 이륜차(car_type=7) 최단거리 숏컷(priority=DISTANCE) 요청
      const KAKAO_URL = `/kakaonavi/v1/directions?origin=${startLng},${startLat}&destination=${endLng},${endLat}&car_type=7&priority=DISTANCE`;
      const KAKAO_REST_API_KEY = import.meta.env.VITE_KAKAO_REST_KEY; // 환경변수 수칙 11 준수

      const response = await fetch(KAKAO_URL, {
        method: 'GET',
        headers: {
          'Authorization': `KakaoAK ${KAKAO_REST_API_KEY}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const path = [];
          route.sections.forEach(section => {
            section.roads.forEach(road => {
              for (let i = 0; i < road.vertexes.length; i += 2) {
                path.push(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
              }
            });
          });
          const distance = route.summary.distance || 0;
            const duration = route.summary.duration || 0;
            
            const kakaoGuides = [];
            if (route.sections[0].guides) {
              route.sections[0].guides.forEach(g => {
                if (g.guidance) {
                  kakaoGuides.push({
                    text: `안전 경로 ${g.guidance}`, // 카카오 원본 데이터에 안전경로 접두사 추가
                    lat: g.y,
                    lng: g.x,
                    alerted: false,
                    type: 'kakao'
                  });
                }
              });
            }
            return { path, distance, duration, guides: kakaoGuides };
        }
      }
    } catch (e) {
      console.error('카카오내비 안전 경로 탐색 실패:', e);
    }
    return null;
  };

  const runRouteSearch = async (startObj, destObj) => {
    if (!destObj) return;
    let startLat = startObj && startObj.lat;
    let startLng = startObj && startObj.lng;

    if (!startLat || !startLng) {
      if (currentPosRef.current) {
        startLat = currentPosRef.current.lat;
        startLng = currentPosRef.current.lng;
      } else {
        alert('위치를 수집 중입니다. 잠시 후 다시 시도해 주세요.');
        fetchCurrentPositionSilent(true);
        return;
      }
    }

    // [듀얼 라우팅] 카카오(안전로)와 BRouter(숏컷) 두 엔진에 동시 요청!
    const [brouterResult, kakaoResult] = await Promise.all([
      fetchBRouterMopedRoute(startLat, startLng, destObj.lat, destObj.lng),
      fetchKakaoNaviRoute(startLat, startLng, destObj.lat, destObj.lng)
    ]);

    if (!brouterResult || !brouterResult.path || brouterResult.path.length === 0) {
      alert('경로 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    if (polylineRef.current) polylineRef.current.setMap(null);
    if (polylineKakaoRef.current) polylineKakaoRef.current.setMap(null);
    if (destinationMarkerRef.current) destinationMarkerRef.current.setMap(null);
    uTurnMarkersRef.current.forEach(marker => marker.setMap(null));
    uTurnMarkersRef.current = [];

    // 1. 카카오 안전 경로 렌더링 (두껍고 옅은 파란색, 지도 바닥에 깔림)
    if (kakaoResult && kakaoResult.path && kakaoResult.path.length > 0) {
      const polylineKakao = new window.kakao.maps.Polyline({
        path: kakaoResult.path,
        strokeWeight: 8,
        strokeColor: '#3366FF',
        strokeOpacity: 0.8,
        strokeStyle: 'solid',
      });
      polylineKakao.setZIndex(1); // zIndex 낮게 설정하여 바닥에 깔림
      polylineKakao.setMap(mapRef.current);
      polylineKakaoRef.current = polylineKakao;
    }

    // 2. BRouter 숏컷 경로 렌더링 (얇고 쨍한 빨간 점선, 파란 선 위로 포개짐)
    const polyline = new window.kakao.maps.Polyline({
      path: brouterResult.path,
      strokeWeight: 4,
      strokeColor: '#FF3344',
      strokeOpacity: 1.0,
      strokeStyle: 'shortdash',
    });
    polyline.setZIndex(2); // zIndex 높게 설정하여 위에 덧그려짐
    polyline.setMap(mapRef.current);
    polylineRef.current = polyline;

    const endMarker = new window.kakao.maps.Marker({
      position: brouterResult.path[brouterResult.path.length - 1],
      map: mapRef.current,
    });
    destinationMarkerRef.current = endMarker;

    uTurnMarkersRef.current = detectAndMarkUTurns(brouterResult.path, mapRef.current);
    routePathRef.current = brouterResult.path;
        brouterGuidesRef.current = brouterResult.guides || []; 
    routePathKakaoRef.current = kakaoResult && kakaoResult.path ? kakaoResult.path : [];
        kakaoGuidesRef.current = kakaoResult && kakaoResult.guides ? kakaoResult.guides : [];
    setRouteTrigger(p => p + 1);

    const bounds = new window.kakao.maps.LatLngBounds();
    brouterResult.path.forEach((p) => bounds.extend(p));
    // 카카오 경로도 바운드에 포함
    if (kakaoResult && kakaoResult.path) {
      kakaoResult.path.forEach((p) => bounds.extend(p));
    }
    mapRef.current.setBounds(bounds);

    const distanceKm = (brouterResult.distance / 1000).toFixed(1);
    const estimatedMinutes = Math.max(1, Math.round(brouterResult.duration / 60));
    const now = new Date();
    now.setMinutes(now.getMinutes() + estimatedMinutes);
    const arrivalTimeStr = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;

    setInstructions(brouterResult.steps || []);
    setCurrentStepIndex(0);
    setIsNavigating(false);
    
    // 길찾기 수행 시 안내 음성 메모리 초기화
    announcedCamerasRef.current.clear();

    setRouteInfo({
      distance: distanceKm,
      time: estimatedMinutes,
      arrivalTime: arrivalTimeStr,
      startName: startObj.placeName,
      destinationName: destObj.placeName,
      address: destObj.roadAddress || destObj.address,
    });
  };

  const handleResetRoute = () => {
    stopRealtimeTracking();
    releaseScreenWakeLock();
    if (startLocationMarkerRef.current) {
      startLocationMarkerRef.current.setMap(null);
      startLocationMarkerRef.current = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (polylineRef.current) polylineRef.current.setMap(null);
    if (polylineKakaoRef.current) polylineKakaoRef.current.setMap(null);
    if (destinationMarkerRef.current) destinationMarkerRef.current.setMap(null);
    
    uTurnMarkersRef.current.forEach(marker => marker.setMap(null));
    uTurnMarkersRef.current = [];
    routePathRef.current = [];
    setRouteTrigger(p => p + 1);

    setRouteInfo(null);
    setIsNavigating(false);
    setDestinationQuery('');
    setDestResults([]);
    setSelectedDest(null);
    
    // 경로 초기화 시 음성 메모리 초기화
    announcedCamerasRef.current.clear();
  };

  const handleAddFavorite = (e, place) => {
    e.stopPropagation();
    const exists = favorites.some((fav) => fav.placeName === place.placeName);
    let updated;
    if (exists) updated = favorites.filter((fav) => fav.placeName !== place.placeName);
    else updated = [...favorites, place];
    setFavorites(updated);
    localStorage.setItem('biker_favorites', JSON.stringify(updated));
  };

  const handleRemoveFavorite = (e, place) => {
    e.stopPropagation();
    if (window.confirm(`'${place.placeName}'을(를) 즐겨찾기에서 삭제하시겠습니까?`)) {
      const updated = favorites.filter((fav) => fav.placeName !== place.placeName);
      setFavorites(updated);
      localStorage.setItem('biker_favorites', JSON.stringify(updated));
    }
  };

  const handleSelectFavorite = (place) => {
    if (activeInput === 'start') handleSelectStartPlace(place);
    else handleSelectDestPlace(place);
  };
  
  const handleStartNavigation = () => {
    setIsNavigating(true);
    startRealtimeTracking();
    requestScreenWakeLock();
    if (instructions.length > 0) speakVoiceGuide(`안내를 시작합니다. 전방에 단속 카메라가 있을 경우 음성으로 경고해 드립니다.`);
    
    if (mapRef.current) {
      mapRef.current.setLevel(2); // 주행 모드 돌입 시 지도 바짝 확대 (Level 2)
      if (currentPosRef.current) {
        mapRef.current.panTo(new window.kakao.maps.LatLng(currentPosRef.current.lat, currentPosRef.current.lng));
      }
    }
  };

  const handleStopNavigation = () => {
    setIsNavigating(false);
    stopRealtimeTracking();
    releaseScreenWakeLock();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    announcedCamerasRef.current.clear();
    
    if (mapRef.current) {
      mapRef.current.setLevel(4); // 주행 종료 시 주변 파악을 위해 살짝 축소 (Level 4)
    }
  };

  const handleSelectStartPlace = (place) => {
    setSelectedStart(place);
    setStartQuery(place.placeName);
    setStartResults([]);
    if (mapRef.current && place.lat && place.lng) {
      const startLatLng = new window.kakao.maps.LatLng(place.lat, place.lng);
      mapRef.current.panTo(startLatLng);
      if (startLocationMarkerRef.current) startLocationMarkerRef.current.setPosition(startLatLng);
      else startLocationMarkerRef.current = new window.kakao.maps.Marker({ position: startLatLng, map: mapRef.current });
    }
    if (selectedDest) runRouteSearch(place, selectedDest);
  };

  const handleSelectDestPlace = (place) => {
    setSelectedDest(place);
    setDestinationQuery(place.placeName);
    setDestResults([]);
    runRouteSearch(selectedStart, place);
  };

  const handleResetStartToMyLocation = () => {
    if (startLocationMarkerRef.current) {
      startLocationMarkerRef.current.setMap(null);
      startLocationMarkerRef.current = null;
    }
    const myPosObj = { placeName: '내 위치', lat: null, lng: null };
    setSelectedStart(myPosObj);
    setStartQuery('내 위치');
    setStartResults([]);
    fetchCurrentPositionSilent(true);
    if (selectedDest) runRouteSearch(myPosObj, selectedDest);
  };

  const handleSwapLocations = () => {
    if (!selectedDest) return;
    const newStart = selectedDest;
    const newDest = selectedStart.lat ? selectedStart : { placeName: '내 위치', lat: currentPosRef.current?.lat, lng: currentPosRef.current?.lng, address: '' };
    setSelectedStart(newStart);
    setStartQuery(newStart.placeName);
    setSelectedDest(newDest);
    setDestinationQuery(newDest.placeName);
    runRouteSearch(newStart, newDest);
  };

  const handleMoveToMyPos = () => fetchCurrentPositionSilent(true);

  useEffect(() => {
    if (mapRef.current) return;
    const initMap = () => {
      if (mapRef.current) return;
      const options = { center: new window.kakao.maps.LatLng(37.5665, 126.9780), level: 3 };
      const map = new window.kakao.maps.Map(mapContainerRef.current, options);
      mapRef.current = map;
      fetchCurrentPositionSilent(false);
    };
    if (window.kakao && window.kakao.maps) {
      window.kakao.maps.load(initMap);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${import.meta.env.VITE_KAKAO_MAP_API_KEY}&autoload=false&libraries=services,clusterer`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(initMap);
    document.head.appendChild(script);
    return () => {
      stopRealtimeTracking();
      releaseScreenWakeLock();
    };
  }, []);

  const handleManualReroute = () => {
    if (!currentPosRef.current) return;
    speakVoiceGuide("수동으로 경로를 재탐색합니다.");
    handleAutoReroute(currentPosRef.current.lat, currentPosRef.current.lng, false);
  };

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />

      {/* 지도를 가리는 상단 로켓 배너 제거 (렌더링 스위치 강제 OFF) */}
      {false && isNavigating && instructions.length > 0 && (
        <div className={`turn-banner ${instructions[currentStepIndex]?.isSchoolZone ? 'schoolzone-alert-mode' : ''}`}>
          <span className="turn-arrow">{instructions[currentStepIndex]?.arrow || '⬆️'}</span>
          <div className="turn-text-group">
            {instructions[currentStepIndex]?.alertBadgeText && (
              <span className="camera-badge school-badge">{instructions[currentStepIndex]?.alertBadgeText}</span>
            )}
            <span className="turn-text">{instructions[currentStepIndex]?.text || '직진하세요'}</span>
          </div>
        </div>
      )}

      {!isNavigating && (
        <div className="nav-search-card">
          <div className="input-group-row">
            <div className="input-group">
              <span className="input-label">출발</span>
              <input 
                type="text" 
                className="nav-input" 
                value={startQuery} 
                onFocus={() => setActiveInput('start')}
                onChange={(e) => { setStartQuery(e.target.value); searchPlaceList(e.target.value, true); }} 
                placeholder="출발지 검색" 
              />
              {startQuery !== '내 위치' && (
                <button type="button" className="my-pos-tag-btn" onClick={handleResetStartToMyLocation}>내위치</button>
              )}
            </div>
            <button type="button" className="swap-btn" onClick={handleSwapLocations} title="출발/도착 전환">🔄</button>
          </div>

          {startResults.length > 0 && (
            <ul className="search-results-list">
              {startResults.map((item, idx) => (
                <li key={idx} className="result-item" onClick={() => handleSelectStartPlace(item)}>
                  <div className="result-item-main">
                    <div className="place-name">📍 {item.placeName}</div>
                  </div>
                  <div className="place-address">🏠 {item.address}</div>
                </li>
              ))}
            </ul>
          )}

          <div className="input-group">
            <span className="input-label dest">도착</span>
            <input 
              type="text" 
              className="nav-input" 
              value={destinationQuery} 
              onFocus={() => setActiveInput('dest')}
              onChange={(e) => { setDestinationQuery(e.target.value); searchPlaceList(e.target.value, false); }} 
              placeholder="목적지 검색 (예: 롯데IT캐슬)" 
            />
          </div>

          {destResults.length > 0 && (
            <ul className="search-results-list">
              {destResults.map((item, idx) => (
                <li key={idx} className="result-item" onClick={() => handleSelectDestPlace(item)}>
                  <div className="result-item-main">
                    <div className="place-name">🎯 {item.placeName}</div>
                    <button type="button" className="fav-btn" onClick={(e) => handleAddFavorite(e, item)} title="즐겨찾기 저장">
                      {favorites.some((f) => f.placeName === item.placeName) ? '⭐' : '☆'}
                    </button>
                  </div>
                  <div className="place-address">🏠 {item.address}</div>
                </li>
              ))}
            </ul>
          )}

          {favorites.length > 0 && (
            <div className="favorites-chip-bar">
              <span className="fav-title">⭐ 즐겨찾기:</span>
              <div className="fav-chip-list">
                {favorites.map((fav, idx) => (
                  <div key={idx} className="fav-chip" onClick={() => handleSelectFavorite(fav)}>
                    <span className="fav-chip-name">{fav.placeName}</span>
                    <span className="fav-chip-del" onClick={(e) => handleRemoveFavorite(e, fav)}>✕</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {routeInfo && (
        <div className={`route-info-card ${isNavigating ? 'mini-mode' : ''}`}>
          {!isNavigating ? (
            <>
              <div className="info-header">
                <span className="dest-title">🎯 {routeInfo.destinationName}</span>
                <button type="button" className="close-btn" onClick={handleResetRoute}>✕</button>
              </div>
              <div className="info-body">
                <span className="time-highlight">약 {routeInfo.time}분</span>
                <span className="dist-text">({routeInfo.distance} km)</span>
                <span className="badge-alley">🛵 🚨U턴 탐지 및 자동 재탐색</span>
              </div>
              <div className="address-sub">도착지: {routeInfo.address}</div>
              <div className="disclaimer-box">
                ⚠️ 오픈소스 지도의 특성상 <strong>일방통행(역주행), 진입금지, 불법 U턴</strong> 정보가 부정확할 수 있습니다. 주행 중 발생하는 모든 사고 및 법적 책임은 운전자 본인에게 있으므로, 반드시 현장 도로 표지판에 따라 합법적인 주행을 하시기 바랍니다.
              </div>
              <button type="button" className="start-nav-btn" onClick={handleStartNavigation}>🚀 안내 시작</button>
            </>
          ) : (
             <div className="navigating-bottom-bar">
              <div className="mini-info">
                <span className="mini-time">약 {routeInfo.time}분</span>
                <span className="mini-dist">{routeInfo.distance} km</span>
              </div>
              <div className="action-row">
                <button type="button" className="reroute-btn" onClick={handleManualReroute} style={{ marginRight: '8px', backgroundColor: '#3366FF', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '8px', fontWeight: 'bold' }}>🔄 수동 재탐색</button>
                <button type="button" className="stop-nav-btn" onClick={handleStopNavigation}>주행 종료</button>
              </div>
            </div>
          )}
        </div>
      )}

      <button type="button" className="current-location-btn" onClick={handleMoveToMyPos}>🎯 내 위치</button>
    </div>
  );
}

export default App;