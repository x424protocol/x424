import {
  createHumanRequirement,
  decodeHumanRequirement,
  humanRequiredResponse,
} from "../src/index.js";

const requirement = createHumanRequirement({
  purpose: "publish-record",
  method: "POST",
  uri: "https://api.example.test/records",
  audience: "https://api.example.test",
  body: { title: "A human-gated record" },
  binding: { kind: "agent_key", value: "sha256:agent-public-key" },
  accepts: [
    {
      providerId: "world",
      methodId: "world-id-4-orb",
      descriptorVersion: "1",
      assuranceLevel: "orb",
      acceptedScopeKinds: ["action"],
      verificationModes: ["backend"],
    },
  ],
  providerRequests: {
    "world:world-id-4-orb": {
      rpId: "rp_example",
      action: "publish-record",
      signedRequest: "issued-by-the-relying-party-backend",
    },
  },
});

const response = humanRequiredResponse(requirement);
const decoded = decodeHumanRequirement(response.headers["human-required"]!);

console.log(JSON.stringify({ response, decoded }, null, 2));
