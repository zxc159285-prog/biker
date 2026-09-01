const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'public', 'safemap_data.json');

function processData() {
    const results = [];

    // Helper to safely parse numbers
    const parseNum = (val) => {
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
    };

    // 1. 단속카메라 데이터 (지능형 오토바이 필터 + 주정차 카메라 구출)
    const camFile = path.join(__dirname, '전국무인교통단속카메라표준데이터.json');
    if (fs.existsSync(camFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(camFile, 'utf8'));
            const records = data.records || [];
            let droppedCount = 0;

            records.forEach(r => {
                const lat = parseNum(r['위도']);
                const lng = parseNum(r['경도']);
                if (lat > 30 && lng > 120) {
                    const code = String(r['단속구분'] || '').trim();
                    const desc = code + ' ' + (r['설치장소'] || '');

                    // 오토바이 관련 키워드가 있는지 확인
                    const isMotorcycleSpecific = desc.includes('후면') || desc.includes('이륜') || desc.includes('안전모');
                    
                    // 기본 과속(1) 및 신호위반(2) 확인
                    const isStandardEnforcement = ['1', '01', '2', '02', '1+2', '01+02'].includes(code);

                    // 불법주정차 단속 카메라(3) 구출
                    const isParkingEnforcement = ['3', '03'].includes(code);

                    // 3가지 목적에 모두 해당하지 않는 찐 쓰레기 데이터(적재불량, 과적 등) 가차없이 버림
                    if (!isMotorcycleSpecific && !isStandardEnforcement && !isParkingEnforcement) {
                        droppedCount++;
                        return; // Skip this record
                    }

                    let speed = parseInt(r['제한속도'], 10);
                    if (isNaN(speed)) speed = 0;

                    let camType = 'camera';
                    if (isParkingEnforcement && !isMotorcycleSpecific) {
                        camType = 'parking'; // 구출해낸 주정차 마커 지정
                    } else if (isMotorcycleSpecific) {
                        camType = 'rear_camera';
                    }

                    results.push({
                        type: camType,
                        lat: lat,
                        lng: lng,
                        speed: speed
                    });
                }
            });
            console.log(`Loaded Cameras: processed ${records.length - droppedCount} records. (Dropped ${droppedCount} irrelevant cameras)`);
        } catch (e) {
            console.error('Error processing cameras:', e.message);
        }
    }

    // 2. 어린이 보호구역
    const schoolFile = path.join(__dirname, '전국어린이보호구역표준데이터.json');
    if (fs.existsSync(schoolFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(schoolFile, 'utf8'));
            const records = data.records || [];
            records.forEach(r => {
                const lat = parseNum(r['위도']);
                const lng = parseNum(r['경도']);
                if (lat > 30 && lng > 120) {
                    results.push({
                        type: 'schoolzone',
                        lat: lat,
                        lng: lng,
                        speed: 30
                    });
                }
            });
            console.log(`Loaded School zones: ${records.length} records processed.`);
        } catch (e) {
            console.error('Error processing school zones:', e.message);
        }
    }

    // Save to public folder
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results), 'utf8');
    console.log(`\nSuccess! Extracted ${results.length} highly relevant locations to public/safemap_data.json`);
}

processData();
