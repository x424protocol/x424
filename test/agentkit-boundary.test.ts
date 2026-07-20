import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    const child = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) files.push(...(await sourceFiles(child)));
    else if (entry.name.endsWith(".ts")) files.push(child);
  }
  return files;
}

describe("AgentKit isolation", () => {
  it("keeps AgentKit absent from package, lockfile, core source, and runtime", async () => {
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const lockfile = await readFile(
      new URL("../pnpm-lock.yaml", import.meta.url),
      "utf8",
    );
    const runtime = await readFile(
      new URL("../deploy/verifier/entrypoint.mjs", import.meta.url),
      "utf8",
    );
    const sources = await sourceFiles(new URL("../src/", import.meta.url));
    const sourceText = (
      await Promise.all(sources.map((file) => readFile(file, "utf8")))
    ).join("\n");
    expect(
      `${packageJson}\n${lockfile}\n${runtime}\n${sourceText}`.toLowerCase(),
    ).not.toContain("agentkit");
  });
});
