// ============================================================
// GPS 노이즈 탐지 모듈
// 하버사인 공식으로 연속 좌표 간 이동속도 계산,
// 시속 20km 초과 시 노이즈로 판정
// ============================================================

const GPS_NOISE_SPEED_LIMIT_KMH = 20;

// 하버사인 공식 - 두 GPS 좌표 사이의 거리(km) 반환
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 좌표 배열에서 노이즈 좌표 탐지
// 입력: [{ lat, lng, timestamp }, ...]
// 반환: 노이즈 판정된 항목 배열 (noiseIndex, distanceKm, speedKmh 포함)
function detectGpsNoise(track) {
  const noises = [];
  for (let i = 1; i < track.length; i++) {
    const prev = track[i - 1];
    const curr = track[i];
    const distKm = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    const deltaHour = (curr.timestamp - prev.timestamp) / 3600000;
    if (deltaHour <= 0) continue;
    const speedKmh = distKm / deltaHour;
    if (speedKmh > GPS_NOISE_SPEED_LIMIT_KMH) {
      noises.push({
        noiseIndex: i,
        lat: curr.lat,
        lng: curr.lng,
        timestamp: curr.timestamp,
        distanceKm: Math.round(distKm * 1000) / 1000,
        speedKmh: Math.round(speedKmh)
      });
    }
  }
  return noises;
}

// 더미 GPS 트랙 생성 (일부 노이즈 포함)
function generateDummyTrackWithNoise(sessionSeed, pointCount) {
  const baseLat = 37.55 + seededRandom(sessionSeed) * 0.05;
  const baseLng = 126.97 + seededRandom(sessionSeed + 1) * 0.05;
  const startTime = new Date("2026-06-11T09:00:00").getTime();
  const track = [];
  for (let i = 0; i < pointCount; i++) {
    const jitter = 0.0008;
    const lat = baseLat + (seededRandom(sessionSeed * 100 + i) - 0.5) * jitter;
    const lng = baseLng + (seededRandom(sessionSeed * 100 + i + 1) - 0.5) * jitter;
    const timestamp = startTime + i * 10000; // 10초 간격
    track.push({ lat, lng, timestamp });
  }
  // 노이즈 3개 삽입 (비현실적으로 먼 좌표로 교체)
  const noisePositions = [3, 8, Math.floor(pointCount * 0.6)];
  noisePositions.forEach((pos, ni) => {
    if (pos < track.length) {
      track[pos].lat += 0.3 + seededRandom(sessionSeed + ni) * 0.2;
      track[pos].lng += 0.3 + seededRandom(sessionSeed + ni + 5) * 0.2;
    }
  });
  return track;
}

// GPS 노이즈 탐지 결과 통계 생성
function generateGpsNoiseStats() {
  const sessionCount = 15;
  const results = [];
  let totalNoiseCount = 0;
  for (let s = 1; s <= sessionCount; s++) {
    const pointCount = 10 + Math.round(seededRandom(s + 200) * 15);
    const track = generateDummyTrackWithNoise(s, pointCount);
    const noises = detectGpsNoise(track);
    if (noises.length > 0) {
      totalNoiseCount += noises.length;
      results.push({ sessionSeed: s, noises });
    }
  }
  return { totalNoiseCount, results };
}

// 모달 상세 목록용 데이터 생성
function generateGpsNoiseDetailList() {
  const { results } = generateGpsNoiseStats();
  const list = [];
  let rowId = 1;
  results.forEach(({ sessionSeed, noises }) => {
    noises.forEach((n) => {
      const d = new Date(n.timestamp);
      const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
      list.push({
        sessionId: `SES-${10200 + sessionSeed}`,
        userNo: `#${1000 + (sessionSeed % 18) + 1}`,
        date: dateStr,
        detail: `속도 ${n.speedKmh}km/h (${n.distanceKm}km 이동)`
      });
      rowId++;
    });
  });
  return list;
}
