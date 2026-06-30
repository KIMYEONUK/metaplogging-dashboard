// 플로깅 세션 GPS로 결정한 시·군·구를 사진 수거량 기준으로 집계합니다.
function generateDistrictPieData() {
  const sessions = new Map((DB_SNAPSHOT.sessions || []).map((session) => [session.id, session]));
  const tally = {};
  (DB_SNAPSHOT.photos || []).forEach((photo) => {
    const district = sessions.get(photo.sessionId)?.district || "미지정";
    tally[district] = (tally[district] || 0) + 1;
  });
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return {
    labels: sorted.map(([label]) => label),
    values: sorted.map(([, value]) => value)
  };
}
