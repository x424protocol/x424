#!/usr/bin/env node
/**
 * Black-box conformance runner (P4B-01 scaffold).
 * Executes published vectors against the reference evaluation path.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeHumanRequirement, encodeHumanResult } from "../http.js";
import { evaluateHumanResult } from "../policy.js";
import { methodKey } from "../catalog.js";
import { requestDigest, X424_CANON_PROFILE } from "../canonical.js";
import type {
  HumanMethodDescriptor,
  HumanRequirement,
  HumanResult,
} from "../types.js";

interface VectorFile {
  readonly x424Version: string;
  readonly evaluationTime: string;
  readonly expiredEvaluationTime: string;
  readonly methodDescriptor: HumanMethodDescriptor;
  readonly requirement: HumanRequirement;
  readonly result: HumanResult;
  readonly humanRequired: string;
  readonly humanResult: string;
  readonly negativeResultMutations: readonly {
    readonly name: string;
    readonly patch: Partial<HumanResult>;
    readonly expectedFailureCodes: readonly string[];
  }[];
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function pass(name: string): void {
  console.log(`PASS: ${name}`);
}

export async function runConformanceVectors(vectorPath: string): Promise<void> {
  const raw = await readFile(vectorPath, "utf8");
  const vectors = JSON.parse(raw) as VectorFile;
  const catalog = new Map([
    [
      methodKey(
        vectors.methodDescriptor.providerId,
        vectors.methodDescriptor.methodId,
      ),
      vectors.methodDescriptor,
    ],
  ]);

  if (encodeHumanRequirement(vectors.requirement) !== vectors.humanRequired) {
    fail("humanRequired encoding mismatch");
  }
  pass("humanRequired-encoding");

  if (encodeHumanResult(vectors.result) !== vectors.humanResult) {
    fail("humanResult encoding mismatch");
  }
  pass("humanResult-encoding");

  const digest = requestDigest({
    method: "POST",
    uri: "https://api.example.test/records",
    body: { title: "Conformance fixture" },
  });
  if (digest !== vectors.requirement.resource.requestDigest) {
    fail("requestDigest mismatch");
  }
  pass(`requestDigest:${X424_CANON_PROFILE}`);

  const ok = evaluateHumanResult({
    requirement: vectors.requirement,
    result: vectors.result,
    catalog,
    now: new Date(vectors.evaluationTime),
  });
  if (!ok.satisfied) fail("positive result rejected");
  pass("positive-result");

  const expired = evaluateHumanResult({
    requirement: vectors.requirement,
    result: vectors.result,
    catalog,
    now: new Date(vectors.expiredEvaluationTime),
  });
  if (expired.satisfied) fail("expired evaluation accepted");
  pass("expired-result");

  for (const mutation of vectors.negativeResultMutations) {
    const mutated = { ...vectors.result, ...mutation.patch } as HumanResult;
    const evaluation = evaluateHumanResult({
      requirement: vectors.requirement,
      result: mutated,
      catalog,
      now: new Date(vectors.evaluationTime),
    });
    if (evaluation.satisfied) fail(`negative ${mutation.name} accepted`);
    const codes = new Set(evaluation.failures.map((f) => f.code));
    for (const expected of mutation.expectedFailureCodes) {
      if (!codes.has(expected as never)) {
        fail(`negative ${mutation.name} missing ${expected}`);
      }
    }
    pass(`negative:${mutation.name}`);
  }

  console.log("conformance suite complete");
}

const defaultVectors = fileURLToPath(
  new URL("../../conformance/v0.1/vectors.json", import.meta.url),
);

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  await runConformanceVectors(process.argv[2] ?? defaultVectors);
}
