import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVerifierMetadataHandler,
  type IssuanceAuthenticator,
  type RateLimitResult,
} from "../src/index.js";

describe("verifier metadata route", () => {
  const servers: Array<{ close(): void }> = [];

  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  it("enforces the published metadata-token size contract", () => {
    const options = {
      issuanceAuthenticator: {
        authenticate: vi.fn<IssuanceAuthenticator["authenticate"]>(),
      },
      rateLimiter: {
        consume: vi.fn<(key: string) => RateLimitResult>(),
      },
    };
    expect(() =>
      createVerifierMetadataHandler({ token: "", ...options }),
    ).toThrow(/between 1 and 65536/);
    expect(() =>
      createVerifierMetadataHandler({
        token: "x".repeat(65_537),
        ...options,
      }),
    ).toThrow(/between 1 and 65536/);
    expect(() =>
      createVerifierMetadataHandler({
        token: "x".repeat(65_536),
        ...options,
      }),
    ).not.toThrow();
  });

  async function start(options: {
    issuanceAuthenticator: IssuanceAuthenticator;
    consume: (key: string) => RateLimitResult | Promise<RateLimitResult>;
  }): Promise<string> {
    const app = express();
    app.get(
      "/.well-known/x424-verifier",
      createVerifierMetadataHandler({
        token: "signed-metadata-token",
        issuanceAuthenticator: options.issuanceAuthenticator,
        rateLimiter: { consume: options.consume },
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/.well-known/x424-verifier`;
  }

  function expectPrivate(response: Response): void {
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("vary")?.toLowerCase()).toContain(
      "authorization",
    );
  }

  it("throttles invalid credentials before another authentication attempt", async () => {
    const authenticate = vi
      .fn<IssuanceAuthenticator["authenticate"]>()
      .mockRejectedValue(new Error("invalid"));
    const consume = vi
      .fn<(key: string) => Promise<RateLimitResult>>()
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 1,
        resetAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      });
    const url = await start({
      issuanceAuthenticator: { authenticate },
      consume,
    });

    const unauthenticated = await fetch(url, {
      headers: { authorization: "Bearer guessed-token" },
    });
    expect(unauthenticated.status).toBe(401);
    expectPrivate(unauthenticated);
    expect(unauthenticated.headers.get("www-authenticate")).toBe(
      'Bearer realm="x424-verifier-metadata"',
    );

    const limited = await fetch(url, {
      headers: { authorization: "Bearer guessed-token" },
    });
    expect(limited.status).toBe(429);
    expectPrivate(limited);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(
      1,
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(2);
    for (const [key] of consume.mock.calls) {
      expect(key).toMatch(/^metadata:authenticate:ip:[A-Za-z0-9_-]{43}$/u);
      expect(key).not.toContain("127.0.0.1");
      expect(key).not.toContain("guessed-token");
    }
  });

  it("returns authenticated metadata below the limit with private headers", async () => {
    const authenticate = vi
      .fn<IssuanceAuthenticator["authenticate"]>()
      .mockResolvedValue({
        subject: "metadata-reader",
        __devWildcardIssuance: true,
      });
    const url = await start({
      issuanceAuthenticator: { authenticate },
      consume: async () => ({
        allowed: true,
        remaining: 11,
        resetAt: Date.now() + 60_000,
      }),
    });

    const response = await fetch(url, {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(response.headers.get("x-ratelimit-remaining")).toBe("11");
    await expect(response.json()).resolves.toEqual({
      token: "signed-metadata-token",
    });
  });

  it("fails closed before authentication when the limiter is unavailable", async () => {
    const authenticate = vi.fn<IssuanceAuthenticator["authenticate"]>();
    const url = await start({
      issuanceAuthenticator: { authenticate },
      consume: async () => {
        throw new Error("Redis unavailable");
      },
    });

    const response = await fetch(url, {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(authenticate).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("signed-metadata-token");
  });
});
