import { spawn } from "node:child_process";
import { createServer } from "node:net";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local port");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
        ),
      );
    });
  });
}

function waitUntilListening(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error("Local x424 stack did not become ready in 20s")),
      20_000,
    );
    const finish = (callback, value) => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      callback(value);
    };
    const onData = (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString();
      if (output.includes('"msg":"local-stack listening"')) {
        finish(resolve);
      }
    };
    const onError = (error) => finish(reject, error);
    const onExit = (code) =>
      finish(reject, new Error(`Local x424 stack exited early with ${code}`));

    child.stdout?.on("data", onData);
    child.stderr?.pipe(process.stderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const stack = spawn(
  pnpm,
  ["exec", "tsx", "examples/world-browser/local-stack.ts"],
  {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

try {
  await waitUntilListening(stack);
  await run(
    pnpm,
    ["exec", "tsx", "examples/world-browser/scripted-client.ts"],
    {
      env: {
        ...process.env,
        X424_RESOURCE_URL: `${origin}/records`,
        X424_VERIFIER_URL: `${origin}/`,
      },
    },
  );
  console.log(
    "x424 quickstart passed: 424 challenge → proof → bound retry → 201",
  );
} finally {
  stack.kill("SIGTERM");
}
