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
  execFileSync("npm", ["install", tarballPath], { cwd: work, stdio: "inherit" });

  const smoke = `
    import('x424/core').then(async (core) => {
      const digest = core.requestDigest({ method: 'GET', uri: 'https://example.test/' });
      if (!digest.startsWith('sha256:')) throw new Error('core digest failed');
      await import('x424/client');
      await import('x424/adapters');
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
