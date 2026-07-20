import {
  createHumanRequirement,
  createWorldIdMethodRequirement,
  createWorldIdProviderRequest,
  decodeHumanRequirement,
  humanRequiredResponse,
} from "../src/index.js";

const binding = {
  kind: "agent_key",
  value: "sha256:agent-public-key",
} as const;
const providerRequest = createWorldIdProviderRequest({
  appId: "app_example",
  rpId: "rp_example",
  action: "publish-record",
  environment: "staging",
  signingKeyHex: `0x${"ab".repeat(32)}`,
  binding,
});

const requirement = createHumanRequirement({
  purpose: "publish-record",
  method: "POST",
  uri: "https://api.example.test/records",
  audience: "https://api.example.test",
  body: { title: "A human-gated record" },
  binding,
  accepts: [createWorldIdMethodRequirement()],
  providerRequests: {
    "world:proof-of-human": providerRequest,
  },
});

const response = humanRequiredResponse(requirement);
const decoded = decodeHumanRequirement(response.headers["human-required"]!);

console.log(JSON.stringify({ response, decoded }, null, 2));
