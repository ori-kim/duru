# Repository Instructions

- 외부 명령은 최대한 clip에 통합하고 사용할 때도 clip을 사용하세요. clip에서 특정 도구의 output이 너무 커지면 context-mode를 사용하세요.
- 코드, 테스트 fixture, 문서, 스펙, 설정 예시에는 회사/팀/개인/특정 도메인에 종속된 이름, 실제 사내 도메인, 실제 서비스명, 실제 헤더/토큰 이름을 넣지 마세요.
- CLI/API 예시는 `example`, `test-service`, `catservice`, `notes-api`, `search-api`, `https://api.example.com`, `https://catservice.example.com`, `/v1/items`, `/v1/cats`, `X-Custom-Header`, `tag:test-service`처럼 전형적인 generic 예시만 사용하세요.
- 시크릿, env, token, API key, 계정 ID, tenant ID, workspace ID는 실제 값처럼 보이는 문자열도 커밋하지 말고 `dummy-token`, `example-token`, `test-workspace`, `custom-from-config`처럼 명백한 더미 값을 사용하세요.
