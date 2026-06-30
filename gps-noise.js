// GPS 노이즈는 sync_db.py가 비공개 원본 좌표로 계산합니다.
// 브라우저에는 원본 이동 경로가 아니라 익명 세션별 탐지 결과만 전달됩니다.

function generateGpsNoiseStats() {
  return DB_SNAPSHOT.gpsNoise || { speedLimitKmh: 20, totalNoiseCount: 0, items: [] };
}

function generateGpsNoiseDetailList() {
  const sessionMap = new Map((DB_SNAPSHOT.sessions || []).map((session) => [session.id, session]));
  return generateGpsNoiseStats().items.map((noise) => {
    const session = sessionMap.get(noise.sessionId);
    return {
      sessionId: noise.sessionId,
      userNo: userNumber(session?.userId || "unknown"),
      date: new Date(noise.detectedAt).toLocaleDateString("ko-KR"),
      detail: `속도 ${noise.speedKmh}km/h (${Number(noise.distanceKm).toFixed(3)}km 이동)`
    };
  });
}
