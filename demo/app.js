const requirementForm = document.querySelector("#requirement-form");
const proofForm = document.querySelector("#proof-form");
const requirementOutput = document.querySelector("#requirement-output");
const resultOutput = document.querySelector("#result-output");

let activeRequirement;

function display(target, value) {
  target.textContent = JSON.stringify(value, null, 2);
}

requirementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(requirementForm);
  const verifier = String(data.get("verifier")).replace(/\/$/, "");
  requirementOutput.textContent = "Issuing dependency…";
  try {
    const response = await fetch(`${verifier}/v1/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: data.get("purpose"),
        method: "POST",
        uri: data.get("uri"),
        audience: data.get("audience"),
        binding: { kind: "agent_key", value: data.get("binding") },
        accepts: [
          {
            providerId: data.get("providerId"),
            methodId: data.get("methodId"),
            descriptorVersion: data.get("descriptorVersion"),
            ...(data.get("assuranceLevel")
              ? { assuranceLevel: data.get("assuranceLevel") }
              : {}),
            acceptedScopeKinds: [data.get("scopeKind")],
            verificationModes: [data.get("verificationMode")],
            maximumProofAgeSeconds: 300,
          },
        ],
        ttlSeconds: 300,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? `HTTP ${response.status}`);
    activeRequirement = { verifier, requirement: body.requirement };
    display(requirementOutput, {
      status: response.status,
      humanRequired: response.headers.get("human-required"),
      requirement: body.requirement,
    });
  } catch (error) {
    display(requirementOutput, { error: error.message });
  }
});

proofForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeRequirement) {
    display(resultOutput, { error: "Create a dependency first." });
    return;
  }
  const data = new FormData(proofForm);
  try {
    const nativeProof = JSON.parse(String(data.get("nativeProof")));
    const { verifier, requirement } = activeRequirement;
    const accepted = requirement.accepts[0];
    const response = await fetch(
      `${verifier}/v1/requirements/${encodeURIComponent(requirement.dependencyId)}/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          x424Version: "0.1",
          dependencyId: requirement.dependencyId,
          providerId: accepted.providerId,
          methodId: accepted.methodId,
          binding: requirement.binding,
          nativeProof,
        }),
      },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? `HTTP ${response.status}`);
    display(resultOutput, {
      status: response.status,
      humanResult: response.headers.get("human-result"),
      result: body.result,
    });
  } catch (error) {
    display(resultOutput, { error: error.message });
  }
});
