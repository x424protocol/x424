/**
 * Scripted browser-equivalent client using only public package APIs.
 * Uses a fake provider proof resolver — no real World credentials.
 */
import {
  createHttpHumanDependencyResolver,
  fetchWithX424,
} from "../../src/client.js";

const resourceUrl =
  process.env.X424_RESOURCE_URL ?? "http://127.0.0.1:9070/records";
const verifierUrl = process.env.X424_VERIFIER_URL ?? "http://127.0.0.1:9070/";

const resolveHumanDependency = createHttpHumanDependencyResolver({
  verifierUrl,
  allowHttpLocalhost: true,
  resolveProviderProof: async ({ requirement }) => {
    const accepted = requirement.accepts[0];
    if (!accepted) throw new Error("No accepted method");
    if (accepted.methodId === "orb-legacy") {
      throw new Error("Legacy method must not be selected by default");
    }
    // Native proof is opaque to core; the local fake verifier accepts this shape.
    return {
      providerId: accepted.providerId,
      methodId: accepted.methodId,
      descriptorVersion: accepted.descriptorVersion,
      nativeProof: {
        fixture: true,
        binding: requirement.binding.value,
      },
    };
  },
});

const response = await fetchWithX424(
  resourceUrl,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "demo-1",
      "x-session-binding": "sha256:demo-session",
    },
    body: JSON.stringify({ title: "Human-gated record" }),
  },
  { resolveHumanDependency },
);
const body = await response.text();

console.log(
  JSON.stringify(
    {
      status: response.status,
      body,
    },
    null,
    2,
  ),
);

if (response.status !== 201) {
  throw new Error(
    `Expected protected action to return 201, received ${response.status}`,
  );
}
