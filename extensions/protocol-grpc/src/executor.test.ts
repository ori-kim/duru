import { describe, expect, test } from "bun:test";
import { buildGrpcurlCommand } from "./executor.ts";

describe("gRPC dry run", () => {
  test("formats a grpcurl preview command", () => {
    const out = buildGrpcurlCommand([
      "-plaintext",
      "-rpc-header",
      "authorization: Bearer token",
      "-d",
      '{"id":"123","name":"Jane Doe"}',
      "localhost:50051",
      "petstore.PetService.GetPet",
    ]);

    expect(out).toBe(
      'grpcurl -plaintext -rpc-header \'authorization: Bearer token\' -d \'{"id":"123","name":"Jane Doe"}\' localhost:50051 petstore.PetService.GetPet\n',
    );
  });
});
