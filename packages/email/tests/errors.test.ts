import { describe, expect, it } from "vitest";
import { toEmailError } from "../src/index.js";

function codedError(message: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(message), fields);
}

describe("toEmailError", () => {
  it.each([
    [codedError("socket timed out", { code: "ETIMEDOUT" }), "CONNECTION"],
    [codedError("TLS handshake failed", { code: "ETLS" }), "CONNECTION"],
    [codedError("REQUIRETLS unavailable", { code: "EREQUIRETLS" }), "CONNECTION"],
    [codedError("recipient rejected", { responseCode: 550 }), "DELIVERY"],
    [codedError("message stream failed", { code: "ESTREAM" }), "DELIVERY"],
    [codedError("credentials missing", { code: "ENOAUTH" }), "AUTHENTICATION"],
  ])("classifies transport failures", (source, expectedCode) => {
    expect(toEmailError(source)).toMatchObject({ code: expectedCode });
  });

  it("redacts configured secrets from the public message", () => {
    const secret = "smtp-secret-value";
    const error = toEmailError(new Error(`failed with ${secret}`), [secret]);
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain(secret);
  });
});
