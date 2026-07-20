import { x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createHttpHumanDependencyResolver } from "x424/client";
import { createWorldIdIdKitProofResolver } from "x424/providers/world-id/client";
import {
  createOfficialX402PaymentResolver,
  fetchWithX424AndX402,
} from "x424/x402";

/** Browser/direct ceremony example. Agents use createX424AgentClient(). */
export async function callPaidHumanApi(input: {
  readonly signer: ConstructorParameters<typeof ExactEvmScheme>[0];
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
