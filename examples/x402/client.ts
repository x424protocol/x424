import { x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createHttpHumanDependencyResolver } from "x424/client";
import { createWorldIdIdKitProofResolver } from "x424/providers/world-id/client";
import {
  createOfficialX402PaymentResolver,
  fetchWithX424AndX402,
} from "x424/x402";

/** Works with a browser wallet signer or an agent-controlled delegated signer. */
export async function callPaidHumanApi(input: {
  readonly signer: ConstructorParameters<typeof ExactEvmScheme>[0];
  readonly agentKeyFingerprint: string;
  readonly verifierUrl: string;
  readonly projectToken: string;
  readonly showWorldConnector: (uri: string) => void | Promise<void>;
}) {
  const paymentClient = new x402Client().register(
    "eip155:*",
    new ExactEvmScheme(input.signer),
  );
  return fetchWithX424AndX402(
    "https://api.example.com/paid-action",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-agent-key": input.agentKeyFingerprint,
      },
      body: JSON.stringify({ action: "run" }),
    },
    {
      resolveHumanDependency: createHttpHumanDependencyResolver({
        verifierUrl: input.verifierUrl,
        headers: {
          authorization: `Bearer ${input.projectToken}`,
        },
        resolveProviderProof: createWorldIdIdKitProofResolver({
          onConnectorUri: ({ connectorUri }) =>
            input.showWorldConnector(connectorUri),
        }),
      }),
      resolvePaymentDependency: createOfficialX402PaymentResolver({
        client: paymentClient,
        httpClient: new x402HTTPClient(paymentClient),
      }),
    },
  );
}
