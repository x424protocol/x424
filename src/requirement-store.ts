import type { HumanRequirement, RequirementStore } from "./types.js";

/** Process-local requirement storage for tests and development. */
export class InMemoryRequirementStore implements RequirementStore {
  readonly #entries = new Map<string, HumanRequirement>();
  readonly #maximumEntries: number;

  constructor(maximumEntries = 10_000) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error("maximumEntries must be a positive integer");
    }
    this.#maximumEntries = maximumEntries;
  }

  async put(requirement: HumanRequirement): Promise<void> {
    this.#prune(new Date());
    if (this.#entries.has(requirement.dependencyId)) {
      throw new Error("Dependency ID already exists");
    }
    if (this.#entries.size >= this.#maximumEntries) {
      throw new Error("Requirement store is full");
    }
    if (Date.parse(requirement.expiresAt) <= Date.now()) {
      throw new Error("Cannot store an expired human requirement");
    }
    this.#entries.set(requirement.dependencyId, requirement);
  }

  async get(
    dependencyId: string,
    now = new Date(),
  ): Promise<HumanRequirement | undefined> {
    const requirement = this.#entries.get(dependencyId);
    if (!requirement) return undefined;
    if (Date.parse(requirement.expiresAt) <= now.getTime()) {
      this.#entries.delete(dependencyId);
      return undefined;
    }
    return requirement;
  }

  async delete(dependencyId: string): Promise<void> {
    this.#entries.delete(dependencyId);
  }

  #prune(now: Date): void {
    for (const [dependencyId, requirement] of this.#entries) {
      if (Date.parse(requirement.expiresAt) <= now.getTime()) {
        this.#entries.delete(dependencyId);
      }
    }
  }
}
