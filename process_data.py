import json
import os

OUTPUT_FILE = 'public/safemap_data.json'

def process_data():
    results = []

    # 1. 과속/신호 단속카메라
    cam_file = '전국무인교통단속카메라표준데이터.json'
    if os.path.exists(cam_file):
        with open(cam_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            records = data.get('records', [])
            for r in records:
                try:
                    lat = float(r.get('위도', 0) or 0)
                    lng = float(r.get('경도', 0) or 0)
                    if lat > 30 and lng > 120:  # 한국 좌표 범위 필터링
                        speed = str(r.get('제한속도', '0')).strip()
                        if not speed or speed == '': speed = '0'
                        
                        # 카메라 종류 판별 (후면, 이륜차 키워드 확인)
                        cam_type = 'camera'
                        description = str(r.get('단속구분', '')) + " " + str(r.get('설치장소', ''))
                        if '후면' in description or '이륜' in description:
                            cam_type = 'rear_camera'

                        results.append({
                            'type': cam_type,
                            'lat': lat,
                            'lng': lng,
                            'speed': int(speed)
                        })
                except Exception as e:
                    pass
        print(f"Loaded Cameras: {cam_file}")

    # 2. 어린이 보호구역 (스쿨존)
    school_file = '전국어린이보호구역표준데이터.json'
    if os.path.exists(school_file):
        with open(school_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            records = data.get('records', [])
            for r in records:
                try:
                    lat = float(r.get('위도', 0) or 0)
                    lng = float(r.get('경도', 0) or 0)
                    if lat > 30 and lng > 120:
                        results.append({
                            'type': 'schoolzone',
                            'lat': lat,
                            'lng': lng,
                            'speed': 30
                        })
                except Exception:
                    pass
        print(f"Loaded School zones: {school_file}")

    # 3. 불법주정차 단속구역
    parking_file = '전국주정차금지_지정_구역표준데이터.json'
    if os.path.exists(parking_file):
        with open(parking_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            records = data.get('records', [])
            for r in records:
                try:
                    lat = float(r.get('위도', 0) or 0)
                    lng = float(r.get('경도', 0) or 0)
                    if lat > 30 and lng > 120:
                        results.append({
                            'type': 'parking',
                            'lat': lat,
                            'lng': lng
                        })
                except Exception:
                    pass
        print(f"Loaded Parking zones: {parking_file}")

    # Save to public folder
    os.makedirs('public', exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        # Minify JSON output
        json.dump(results, f, ensure_ascii=False, separators=(',', ':'))

    print(f"\nSuccess! Extracted {len(results)} valid locations to {OUTPUT_FILE}")

if __name__ == "__main__":
    process_data()
