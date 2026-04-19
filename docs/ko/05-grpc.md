# gRPC Target

gRPC 서버를 clip 게이트웨이에 등록합니다. 내부적으로 [grpcurl](https://github.com/fullstorydev/grpcurl)을 사용합니다.

## 사전 요구사항

grpcurl (1.8.7 이상) 설치:

```sh
brew install grpcurl
# 또는
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest
```

## 등록

```sh
clip add <name> <host:port> --grpc [proto-file]
```

```sh
# gRPC reflection을 지원하는 서버
clip add my-api localhost:50051

# proto 파일을 사용하는 서버 (reflection 불필요)
clip add my-api localhost:50051 --grpc ./api.proto

# TLS 비활성화
clip add my-api localhost:50051 --grpc ./api.proto --plaintext
```

## Config

`~/.clip/target/grpc/my-api/config.yml`

```yaml
address: localhost:50051
plaintext: true             # TLS 비활성화

# proto 파일 — 서버가 reflection을 지원하면 생략 가능
proto: ./api.proto
importPaths:                # proto 의존성 추가 경로
  - ./proto

# 모든 호출에 함께 전송되는 gRPC metadata
metadata:
  authorization: "Bearer ${API_TOKEN}"

# 스키마 reflection 전용 metadata (호출 metadata와 별개)
reflectMetadata:
  authorization: "Bearer ${API_TOKEN}"

deadline: 30                # 초 단위; 생략하면 deadline 없음
emitDefaults: false         # 응답에 zero-value 필드 포함 여부
allowUnknownFields: false   # 요청에 알 수 없는 필드 허용 여부
```

## 실행

```sh
# 서비스 및 메서드 목록
clip my-api tools

# 메서드 시그니처 확인 (요청/응답 타입)
clip my-api describe UserService.GetUser

# 메시지 타입 전체 목록
clip my-api types

# 메서드 호출
clip my-api UserService.GetUser --id 123
clip my-api UserService.CreateUser --name "Alice" --email "alice@example.com"

# 메서드 도움말
clip my-api UserService.GetUser --help
```

## 스키마 캐시

최초 실행 시 gRPC reflection(또는 proto 파일)으로 스키마를 가져와 `~/.clip/target/grpc/<name>/schema.json`에 캐시합니다.

스키마 갱신:

```sh
clip refresh my-api
```

## Dry Run

실제 실행 없이 grpcurl 명령어를 미리 확인합니다:

```sh
clip my-api UserService.GetUser --id 123 --dry-run
# grpcurl -plaintext -d '{"id":"123"}' localhost:50051 UserService/GetUser
```
