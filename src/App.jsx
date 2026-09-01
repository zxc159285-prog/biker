import { useEffect, useRef, useState } from 'react';
import './App.css';

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
  const uTurnMarkersRef = useRef([]);

  const watchIdRef = useRef(null);
  const wakeLockRef = useRef(null);
  const currentPosRef = useRef(null);
  const lastHeadingRef = useRef(0);

  const isNavigatingRef = useRef(false);
  const routePathRef = useRef([]);
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
        if (hasRoute) {
          if (d.type === 'camera' || d.type === 'rear_camera') {
            return getDistanceToPath(d.lat, d.lng, currentPath) <= 30;
          } else if (d.type === 'schoolzone') {
            return getDistanceToPath(d.lat, d.lng, currentPath) <= 50;
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

  const handleAutoReroute = async (currentLat, currentLng) => {
    if (!selectedDestRef.current || isReroutingRef.current) return;
    isReroutingRef.current = true;
    speakVoiceGuide("경로를 이탈하여 재탐색합니다.");
    
    const routeResult = await fetchBRouterMopedRoute(currentLat, currentLng, selectedDestRef.current.lat, selectedDestRef.current.lng);
    
    if (routeResult && routeResult.path.length > 0) {
      if (polylineRef.current) polylineRef.current.setMap(null);
      uTurnMarkersRef.current.forEach(marker => marker.setMap(null));
      uTurnMarkersRef.current = [];

      const polyline = new window.kakao.maps.Polyline({
        path: routeResult.path,
        strokeWeight: 6,
        strokeColor: '#FF3344',
        strokeOpacity: 0.9,
        strokeStyle: 'solid',
      });
      polyline.setMap(mapRef.current);
      polylineRef.current = polyline;

      uTurnMarkersRef.current = detectAndMarkUTurns(routeResult.path, mapRef.current);
      routePathRef.current = routeResult.path; 
      setRouteTrigger(p => p + 1);

      const distanceKm = (routeResult.distance / 1000).toFixed(1);
      const estimatedMinutes = Math.max(1, Math.round(routeResult.duration / 60));
      
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
          const distanceOffRoute = getDistanceToPath(lat, lng, routePathRef.current);
          
          if (distanceOffRoute > 40) {
            handleAutoReroute(lat, lng);
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

  const fetchBRouterMopedRoute = async (startLat, startLng, endLat, endLng) => {
    try {
      const url = `https://brouter.de/brouter?lonlats=${startLng},${startLat}|${endLng},${endLat}&profile=moped&alternativeidx=0&format=geojson`;
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
            { arrow: '🚀', text: '오토바이 숏컷 진입 (경로 이탈 시 자동 재탐색)', distance: distance, alertBadgeText: '불법 U턴 탐지 레이더 가동중' },
            { arrow: '🏁', text: '지도의 붉은 선을 따라가되, 표지판을 반드시 확인하세요.', distance: 0 }
          ];
          return { path: linePath, distance, duration, steps };
        }
      }
    } catch (e) {
      console.error('BRouter 탐색 실패:', e);
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

    const routeResult = await fetchBRouterMopedRoute(startLat, startLng, destObj.lat, destObj.lng);
    if (!routeResult || !routeResult.path || routeResult.path.length === 0) {
      alert('경로 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    if (polylineRef.current) polylineRef.current.setMap(null);
    if (destinationMarkerRef.current) destinationMarkerRef.current.setMap(null);
    uTurnMarkersRef.current.forEach(marker => marker.setMap(null));
    uTurnMarkersRef.current = [];

    const polyline = new window.kakao.maps.Polyline({
      path: routeResult.path,
      strokeWeight: 6,
      strokeColor: '#FF3344',
      strokeOpacity: 0.9,
      strokeStyle: 'solid',
    });
    polyline.setMap(mapRef.current);
    polylineRef.current = polyline;

    const endMarker = new window.kakao.maps.Marker({
      position: routeResult.path[routeResult.path.length - 1],
      map: mapRef.current,
    });
    destinationMarkerRef.current = endMarker;

    uTurnMarkersRef.current = detectAndMarkUTurns(routeResult.path, mapRef.current);
    routePathRef.current = routeResult.path; 
    setRouteTrigger(p => p + 1);

    const bounds = new window.kakao.maps.LatLngBounds();
    routeResult.path.forEach((p) => bounds.extend(p));
    mapRef.current.setBounds(bounds);

    const distanceKm = (routeResult.distance / 1000).toFixed(1);
    const estimatedMinutes = Math.max(1, Math.round(routeResult.duration / 60));
    const now = new Date();
    now.setMinutes(now.getMinutes() + estimatedMinutes);
    const arrivalTimeStr = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;

    setInstructions(routeResult.steps || []);
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
  };

  const handleStopNavigation = () => {
    setIsNavigating(false);
    stopRealtimeTracking();
    releaseScreenWakeLock();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    announcedCamerasRef.current.clear();
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

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />

      {isNavigating && instructions.length > 0 && (
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