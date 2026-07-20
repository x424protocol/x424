import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  decodeHumanRequirement,
  decodeHumanResult,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  encodeHumanRequirement,
  encodeHumanResult,
  evaluateHumanResult,
  parseHumanRequirement,
  parseHumanResult,
  requestDigest,
  type HumanMethodDescriptor,
  type HumanRequirement,
  type HumanResult,
} from "../src/core.js";

interface JsonSchemaValidator {
  compile(schema: unknown): (data: unknown) => boolean;
}

interface JsonSchemaValidatorConstructor {
  new (options: {
    readonly allErrors: boolean;
    readonly strict: boolean;
  }): JsonSchemaValidator;
}

const loadModule = createRequire(import.meta.url);
const Ajv2020 = loadModule(
  "ajv/dist/2020.js",
) as JsonSchemaValidatorConstructor;
const addFormats = loadModule("ajv-formats") as (
  validator: JsonSchemaValidator,
) => void;

interface ConformanceVectors {
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

async function json(relative: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(relative, import.meta.url), "utf8"),
  ) as unknown;
}

describe("published x424/0.1 conformance artifacts", () => {
  it("keeps JSON Schemas aligned with runtime wire payloads", async () => {
    const vectors = (await json(
      "../conformance/v0.1/vectors.json",
    )) as ConformanceVectors;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const requirementSchema = await json(
      "../schemas/human-requirement-0.1.schema.json",
    );
    const resultSchema = await json("../schemas/human-result-0.1.schema.json");
    const proofSchema = await json(
      "../schemas/human-proof-submission-0.1.schema.json",
    );

    expect(ajv.compile(requirementSchema)(vectors.requirement)).toBe(true);
    expect(ajv.compile(resultSchema)(vectors.result)).toBe(true);
    expect(
      ajv.compile(proofSchema)({
        x424Version: "0.1",
        dependencyId: vectors.requirement.dependencyId,
        providerId: vectors.result.providerId,
        methodId: vectors.result.methodId,
        binding: vectors.requirement.binding,
        nativeProof: { opaque: true },
      }),
    ).toBe(true);
    expect(() => parseHumanRequirement(vectors.requirement)).not.toThrow();
    expect(() => parseHumanResult(vectors.result)).not.toThrow();
  });

  it("reproduces the fixed canonical digest and header encodings", async () => {
    const vectors = (await json(
      "../conformance/v0.1/vectors.json",
    )) as ConformanceVectors;
    expect(
      requestDigest({
        method: "POST",
        uri: "https://api.example.test/records",
        body: { title: "Conformance fixture" },
      }),
    ).toBe(vectors.requirement.resource.requestDigest);
    expect(encodeHumanRequirement(vectors.requirement)).toBe(
      vectors.humanRequired,
    );
    expect(encodeHumanResult(vectors.result)).toBe(vectors.humanResult);
    expect(decodeHumanRequirement(vectors.humanRequired)).toEqual(
      vectors.requirement,
    );
    expect(decodeHumanResult(vectors.humanResult)).toEqual(vectors.result);
  });

  it("fails closed for every published negative result mutation", async () => {
    const vectors = (await json(
      "../conformance/v0.1/vectors.json",
    )) as ConformanceVectors;
    const catalog = defineMethodCatalog([
      defineHumanMethodDescriptor(vectors.methodDescriptor),
    ]);
    const valid = evaluateHumanResult({
      requirement: vectors.requirement,
      result: vectors.result,
      catalog,
      now: new Date(vectors.evaluationTime),
    });
    expect(valid).toEqual({ satisfied: true, failures: [] });

    for (const fixture of vectors.negativeResultMutations) {
      const evaluation = evaluateHumanResult({
        requirement: vectors.requirement,
        result: { ...vectors.result, ...fixture.patch },
        catalog,
        now: new Date(vectors.evaluationTime),
      });
      expect(
        evaluation.failures.map(({ code }) => code),
        fixture.name,
      ).toEqual(expect.arrayContaining([...fixture.expectedFailureCodes]));
    }

    const expired = evaluateHumanResult({
      requirement: vectors.requirement,
      result: vectors.result,
      catalog,
      now: new Date(vectors.expiredEvaluationTime),
    });
    expect(expired.failures.map(({ code }) => code)).toContain("EXPIRED");
  });
});
