# gRPC Target

Registers a gRPC server with the clip gateway. Uses [grpcurl](https://github.com/fullstorydev/grpcurl) under the hood.

## Requirements

Install grpcurl (1.8.7+):

```sh
brew install grpcurl
# or
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest
```

## Register

```sh
clip add <name> <host:port> --grpc [proto-file]
```

```sh
# Server with gRPC reflection enabled
clip add my-api localhost:50051

# Server using a proto file (no reflection needed)
clip add my-api localhost:50051 --grpc ./api.proto

# TLS disabled
clip add my-api localhost:50051 --grpc ./api.proto --plaintext
```

## Config

`~/.clip/target/grpc/my-api/config.yml`

```yaml
address: localhost:50051
plaintext: true             # disable TLS

# Proto file — optional, only if server doesn't support reflection
proto: ./api.proto
importPaths:                # additional import paths for proto dependencies
  - ./proto

# gRPC metadata sent with every call
metadata:
  authorization: "Bearer ${API_TOKEN}"

# Metadata sent only during schema reflection (separate from call metadata)
reflectMetadata:
  authorization: "Bearer ${API_TOKEN}"

deadline: 30                # seconds; omit for no deadline
emitDefaults: false         # include zero-value fields in response output
allowUnknownFields: false   # allow unrecognized fields in request input
```

## Running

```sh
# List all services and methods
clip my-api tools

# Show method signature (request/response types)
clip my-api describe UserService.GetUser

# List all message types
clip my-api types

# Call a method
clip my-api UserService.GetUser --id 123
clip my-api UserService.CreateUser --name "Alice" --email "alice@example.com"

# Method help
clip my-api UserService.GetUser --help
```

## Schema Cache

On first use, clip fetches the schema via gRPC reflection (or parses the proto file) and caches it at `~/.clip/target/grpc/<name>/schema.json`.

Refresh the schema:

```sh
clip refresh my-api
```

## Dry Run

Preview the grpcurl command without executing:

```sh
clip my-api UserService.GetUser --id 123 --dry-run
# grpcurl -plaintext -d '{"id":"123"}' localhost:50051 UserService/GetUser
```
