// 실제 DB GPS 좌표에서 연속 이동속도 20km/h 초과 지점을 노이즈로 판정합니다.
const GPS_NOISE_SPEED_LIMIT_KMH = 20;

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectGpsNoise(track) {
  const noises = [];
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const current = track[index];
    const hours = (new Date(current.recordedAt) - new Date(previous.recordedAt)) / 3600000;
    if (hours <= 0) continue;
    const distanceKm = haversineDistance(previous.lat, previous.lng, current.lat, current.lng);
    const speedKmh = distanceKm / hours;
    if (speedKmh > GPS_NOISE_SPEED_LIMIT_KMH) noises.push({ current, distanceKm, speedKmh });
  }
  return noises;
}

function generateGpsNoiseStats() {
  const grouped = new Map();
  (DB_SNAPSHOT.points || []).forEach((point) => {
    if (!grouped.has(point.sessionId)) grouped.set(point.sessionId, []);
    grouped.get(point.sessionId).push(point);
  });
  const results = [];
  let totalNoiseCount = 0;
  grouped.forEach((points, sessionId) => {
    points.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
    const noises = detectGpsNoise(points);
    if (noises.length) {
      totalNoiseCount += noises.length;
      results.push({ sessionId, noises });
    }
  });
  return { totalNoiseCount, results };
}

function generateGpsNoiseDetailList() {
  const sessionMap = new Map((DB_SNAPSHOT.sessions || []).map((session) => [session.id, session]));
  return generateGpsNoiseStats().results.flatMap(({ sessionId, noises }) => {
    const session = sessionMap.get(sessionId);
    return noises.map((noise) => ({
      sessionId,
      userNo: userNumber(session?.userId || "unknown"),
      date: new Date(noise.current.recordedAt).toLocaleDateString("ko-KR"),
      detail: `속도 ${Math.round(noise.speedKmh)}km/h (${noise.distanceKm.toFixed(3)}km 이동)`
    }));
  });
}
