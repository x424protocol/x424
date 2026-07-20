import { describe, expect, it } from "vitest";
import { CliUsageError, exitFor, parseArguments } from "../src/agent/cli.js";

describe("x424-agent CLI", () => {
  it("accepts only an absolute external signer command", () => {
    expect(
      parseArguments([
        "https://api.example.test/action",
        "--verifier",
        "https://verifier.example.test",
        "--signer-command",
        "/opt/x424/signer",
        "--method",
        "post",
        "--json",
      ]),
    ).toMatchObject({
      method: "POST",
      signerCommand: "/opt/x424/signer",
      json: true,
    });
    expect(() =>
      parseArguments([
        "https://api.example.test/action",
        "--verifier",
        "https://verifier.example.test",
        "--signer-command",
        "./signer",
      ]),
    ).toThrow(CliUsageError);
  });

  it("rejects private-key flags and preserves stable exit classes", () => {
    expect(() =>
      parseArguments([
        "https://api.example.test/action",
        "--verifier",
        "https://verifier.example.test",
        "--signer-command",
        "/opt/x424/signer",
        "--private-key",
        "secret",
      ]),
    ).toThrow(CliUsageError);
    expect(exitFor(new CliUsageError())).toBe(2);
    expect(exitFor(new Error("handoff expired"))).toBe(3);
    expect(exitFor(new Error("provider failure"))).toBe(4);
    expect(exitFor(new Error("signer failure"))).toBe(5);
    expect(exitFor(new Error("transport failure"))).toBe(6);
  });
});
