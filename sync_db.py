#!/usr/bin/env python3
"""읽기 전용 SSH 세션으로 MetaPlogging DB 스냅샷을 갱신한다."""

from __future__ import annotations

import getpass
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile


HOST = "203.234.62.117"
PORT = "8080"
USER = "metaplogging-db-guest"
OUTPUT = Path(__file__).with_name("db-snapshot.js")

SQL = r"""
\pset format unaligned
\pset tuples_only on
\pset pager off
\echo __METAPLOGGING_DATA_START__
SELECT json_build_object(
  'generatedAt', now(),
  'summary', json_build_object(
    'totalUsers', (SELECT count(*) FROM users),
    'totalSessions', (SELECT count(*) FROM tracking_sessions),
    'totalDistanceKm', (SELECT round(coalesce(sum(distance_meters), 0)::numeric / 1000, 1) FROM tracking_sessions),
    'totalActivityHours', (SELECT round(coalesce(sum(duration_seconds), 0)::numeric / 3600, 1) FROM tracking_sessions),
    'totalPhotos', (SELECT count(*) FROM session_photos)
  ),
  'sessions', coalesce((
    SELECT json_agg(json_build_object(
      'id', s.id,
      'userId', s.user_id,
      'status', s.status,
      'startedAt', s.started_at,
      'endedAt', s.ended_at,
      'durationSeconds', coalesce(s.duration_seconds, 0),
      'distanceMeters', coalesce(s.distance_meters, 0)
    ) ORDER BY s.started_at)
    FROM tracking_sessions s
  ), '[]'::json),
  'photos', coalesce((
    SELECT json_agg(json_build_object(
      'id', p.id,
      'sessionId', p.session_id,
      'lat', p.lat,
      'lng', p.lng,
      'takenAt', coalesce(p.taken_at, p.created_at)
    ) ORDER BY coalesce(p.taken_at, p.created_at))
    FROM session_photos p
  ), '[]'::json),
  'points', coalesce((
    SELECT json_agg(json_build_object(
      'sessionId', p.session_id,
      'lat', p.lat,
      'lng', p.lng,
      'recordedAt', p.recorded_at
    ) ORDER BY p.session_id, p.recorded_at)
    FROM tracking_points p
  ), '[]'::json)
);
\echo __METAPLOGGING_DATA_END__
\q
"""


def main() -> None:
    password = getpass.getpass("DB 비밀번호: ")
    if not password:
        raise SystemExit("비밀번호가 입력되지 않았습니다.")

    askpass_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", prefix="metaplogging-askpass-", suffix=".sh", delete=False) as helper:
            helper.write("#!/bin/sh\nprintf '%s\\n' \"$METAPLOGGING_DB_PASSWORD\"\n")
            askpass_path = Path(helper.name)
        askpass_path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)

        env = os.environ.copy()
        env.update({
            "DISPLAY": ":0",
            "SSH_ASKPASS_REQUIRE": "force",
            "SSH_ASKPASS": str(askpass_path),
            "METAPLOGGING_DB_PASSWORD": password,
        })
        command = [
            "ssh", "-T",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "PreferredAuthentications=password",
            "-o", "PubkeyAuthentication=no",
            "-o", "NumberOfPasswordPrompts=1",
            "-p", PORT,
            f"{USER}@{HOST}",
        ]
        # SSH 인증과 자동 실행된 psql이 같은 기존 비밀번호를 각각 사용한다.
        result = subprocess.run(
            command,
            input=f"{password}\n{SQL}",
            text=True,
            capture_output=True,
            env=env,
            timeout=60,
            check=False,
        )
        start_marker = "__METAPLOGGING_DATA_START__"
        end_marker = "__METAPLOGGING_DATA_END__"
        if result.returncode != 0 or start_marker not in result.stdout or end_marker not in result.stdout:
            message = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "DB 응답을 확인할 수 없습니다."
            raise SystemExit(f"갱신 실패: {message}")

        payload = result.stdout.split(start_marker, 1)[1].split(end_marker, 1)[0].strip()
        snapshot = json.loads(payload)
        serialized = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
        OUTPUT.write_text(
            "// sync_db.py가 생성한 읽기 전용 DB 스냅샷입니다.\n"
            f"window.METAPLOGGING_SNAPSHOT = {serialized};\n",
            encoding="utf-8",
        )
        summary = snapshot["summary"]
        print(f"갱신 완료: 사용자 {summary['totalUsers']}명, 세션 {summary['totalSessions']}건, 사진 {summary['totalPhotos']}장")
        print(f"생성 파일: {OUTPUT}")
    finally:
        password = ""
        if askpass_path:
            askpass_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
