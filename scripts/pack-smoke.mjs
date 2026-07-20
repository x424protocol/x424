/**
 * Smoke-test documented exports from a packed tarball (not source).
 * Does not publish. Run: pnpm pack:smoke
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "x424-pack-"));

try {
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
  execFileSync("npm", ["pack", "--ignore-scripts"], {
    cwd: root,
    stdio: "inherit",
  });
  const tarball = readdirSync(root).find(
    (name) => name.startsWith("x424-") && name.endsWith(".tgz"),
  );
  if (!tarball) throw new Error("npm pack did not produce x424-*.tgz");
  const tarballPath = join(root, tarball);
  execFileSync("npm", ["init", "-y"], { cwd: work, stdio: "inherit" });
  execFileSync("npm", ["install", tarballPath], {
    cwd: work,
    stdio: "inherit",
  });

  const smoke = `
    import('x424/core').then(async (core) => {
      const digest = core.requestDigest({ method: 'GET', uri: 'https://example.test/' });
      if (!digest.startsWith('sha256:')) throw new Error('core digest failed');
      const acceptances = new core.InMemoryResultAcceptanceStore();
      const acceptance = {
        resultId: 'packed-result',
        operationId: 'packed-operation',
        requestDigest: digest,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      if (await acceptances.accept(acceptance) !== 'new') throw new Error('acceptance create failed');
      if (await acceptances.accept(acceptance) !== 'same_operation') throw new Error('acceptance retry failed');
      if (await acceptances.accept({ ...acceptance, operationId: 'replay' }) !== 'replay') throw new Error('acceptance replay failed');
      await import('x424/client');
      const agent = await import('x424/agent');
      const { generateKeyPairSync } = await import('node:crypto');
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const signer = agent.createEd25519AgentRequestSigner(privateKey);
      const signed = await agent.signX424AgentRequest(new Request('https://example.test/action'), signer);
      const binding = await agent.verifyX424AgentRequest(signed, {
        resolveKey: agent.createEd25519AgentKeyResolver(new Map([[signer.keyId, publicKey]])),
      });
      if (binding.kind !== 'agent_key' || binding.value !== signer.keyId) throw new Error('packed agent signature failed');
      await import('x424/handoff');
      await import('x424/adapters');
      await import('x424/world');
      await import('x424/fetch');
      await import('x424/next');
      await import('x424/express');
      await import('x424/managed');
      await import('x424/x402');
      await import('x424/middleware');
      await import('x424/postgres');
      console.log('pack-smoke ok', core.X424_VERSION, core.X424_CANON_PROFILE);
    }).catch((error) => { console.error(error); process.exit(1); });
  `;
  execFileSync("node", ["--input-type=module", "-e", smoke], {
    cwd: work,
    stdio: "inherit",
  });
  rmSync(tarballPath, { force: true });
} finally {
  rmSync(work, { recursive: true, force: true });
}
