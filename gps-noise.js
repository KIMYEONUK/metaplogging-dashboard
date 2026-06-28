// 연속 GPS 포인트 사이의 속도가 20km/h를 넘으면 노이즈 후보로 분류합니다.
const GPS_NOISE_SPEED_LIMIT_KMH = 20;

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectGpsNoise(points = []) {
  const sorted = [...points].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
  const noises = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const hours = (new Date(current.recorded_at) - new Date(previous.recorded_at)) / 3600000;
    if (hours <= 0) continue;
    const distanceKm = haversineDistance(previous.lat, previous.lng, current.lat, current.lng);
    const speedKmh = distanceKm / hours;
    if (speedKmh > GPS_NOISE_SPEED_LIMIT_KMH) {
      noises.push({ current, distanceKm, speedKmh });
    }
  }
  return noises;
}

function buildGpsNoiseRows(details, rowFactory) {
  return details.flatMap((detail) => detectGpsNoise(detail.points).map((noise) => ({
    ...rowFactory(detail, `속도 ${Math.round(noise.speedKmh)}km/h (${noise.distanceKm.toFixed(3)}km 이동)`),
    lat: noise.current.lat,
    lng: noise.current.lng
  })));
}
