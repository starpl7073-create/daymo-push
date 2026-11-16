# DAYMO 푸시 서버 설정

1. Cloudflare에서 D1 데이터베이스 `daymo-push`를 만든다.
2. D1 콘솔에서 `schema.sql`을 실행한다. 데이터베이스 ID로 `wrangler.toml`의 예시 ID를 교체한다.
3. Workers Builds에서 이 저장소의 `main`을 연결한다. Worker 이름과 저장소 설정의 이름을 `daymo-push`로 맞춘다.
4. Worker 설정에 `PAIRING_KEY`(32자 이상 랜덤 문자열), `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`를 등록한다. 비밀값은 Cloudflare Secret으로만 입력한다. VAPID 키는 로컬에서 `npx web-push generate-vapid-keys`로 생성하며, subject는 운영자 연락용 `mailto:` 주소를 사용한다.
5. `/health`가 `{"ready":true}`인지 확인하고, DAYMO에 서버 URL과 이 서버용 연동 코드를 연결한다. 아이폰 홈 화면 DAYMO에서 알림을 허용한 뒤 테스트 알림을 수신해야 설정이 완료된다.

이 서버는 최신 DAYMO 클라이언트의 연동 변경이 필요하다. 등록 요청은 DAYMO 배포 origin을 허용하며 Bearer 인증을 요구한다. 요청 본문은 `subscription`과 `jobs`를 받는다. 각 job의 필드는 `id`, `at`(Unix 밀리초), `title`, `body`이고, 동일 구독에 대해 전송 대기 목록 전체를 교체한다. 빈 목록을 보내면 해당 기기의 대기 알림을 비운다. 반복 일정은 클라이언트에서 앞으로 보낼 회차로 변환한다.
