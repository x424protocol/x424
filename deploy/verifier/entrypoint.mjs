/**
 * Verifier process entry. Validates required env before accepting traffic.
 * Profile defaults to eval-redis-0.2 semantics: auth required.
 */

import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required configuration: ${name}`);
    process.exit(1);
  }
  return value;
}

const profile = process.env.X424_DEPLOYMENT_PROFILE ?? "eval-redis-0.2";
if (profile === "prod-ha-0.2" || profile === "eval-redis-0.2") {
  required("X424_PAIRWISE_SECRET");
  required("X424_RESULT_PRIVATE_KEY");
  required("X424_RESULT_KEY_ID");
  required("X424_ISSUANCE_BEARER_TOKENS");
}

const port = Number(process.env.PORT ?? 8080);
let shuttingDown = false;

const server = createServer(async (req, res) => {
  if (shuttingDown) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "shutting_down" }));
    return;
  }
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        protocol: "x424",
        version: "0.1",
        profile,
      }),
    );
    return;
  }
  if (req.url === "/readyz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ready", profile }));
    return;
  }
  res.writeHead(404, { "content-type": "application/problem+json" });
  res.end(
    JSON.stringify({
      type: "https://x424.org/problems/not-found",
      title: "NOT_FOUND",
      status: 404,
      detail:
        "Wire the Express createX424HttpRouter in a full deployment. This image entrypoint exposes health probes and config validation; see deploy/verifier/README.md.",
    }),
  );
});

server.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      msg: "x424 verifier listening",
      port,
      profile,
      // Never log secrets.
    }),
  );
});

function shutdown(signal) {
  shuttingDown = true;
  console.log(JSON.stringify({ msg: "shutdown", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

void require;
