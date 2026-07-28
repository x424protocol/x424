import type {
  HumanRequirement,
  TenantIsolatedRequirementStore,
} from "./types.js";

interface InMemoryRequirementEntry {
  readonly requirement: HumanRequirement;
  readonly tenantId?: string;
}

function assertTenantId(tenantId: string): void {
  if (
    !tenantId ||
    tenantId.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(tenantId)
  ) {
    throw new Error("Invalid requirement tenant ID");
  }
}

/** Process-local requirement storage for tests and development. */
export class InMemoryRequirementStore implements TenantIsolatedRequirementStore {
  readonly tenantIsolation = true as const;
  readonly #entries = new Map<string, InMemoryRequirementEntry>();
  readonly #maximumEntries: number;

  constructor(maximumEntries = 10_000) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error("maximumEntries must be a positive integer");
    }
    this.#maximumEntries = maximumEntries;
  }

  async put(requirement: HumanRequirement): Promise<void> {
    await this.#put(requirement);
  }

  async putForTenant(
    requirement: HumanRequirement,
    tenantId: string,
  ): Promise<void> {
    assertTenantId(tenantId);
    await this.#put(requirement, tenantId);
  }

  async #put(requirement: HumanRequirement, tenantId?: string): Promise<void> {
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
    this.#entries.set(requirement.dependencyId, {
      requirement,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
  }

  async get(
    dependencyId: string,
    now = new Date(),
  ): Promise<HumanRequirement | undefined> {
    return (await this.#getEntry(dependencyId, now))?.requirement;
  }

  async getForTenant(
    dependencyId: string,
    tenantId: string,
    now = new Date(),
  ): Promise<HumanRequirement | undefined> {
    assertTenantId(tenantId);
    const entry = await this.#getEntry(dependencyId, now);
    return entry?.tenantId === tenantId ? entry.requirement : undefined;
  }

  async #getEntry(
    dependencyId: string,
    now: Date,
  ): Promise<InMemoryRequirementEntry | undefined> {
    const entry = this.#entries.get(dependencyId);
    if (!entry) return undefined;
    if (Date.parse(entry.requirement.expiresAt) <= now.getTime()) {
      this.#entries.delete(dependencyId);
      return undefined;
    }
    return entry;
  }

  async delete(dependencyId: string): Promise<void> {
    this.#entries.delete(dependencyId);
  }

  async deleteForTenant(
    dependencyId: string,
    tenantId: string,
  ): Promise<boolean> {
    assertTenantId(tenantId);
    const entry = await this.#getEntry(dependencyId, new Date());
    if (entry?.tenantId !== tenantId) return false;
    return this.#entries.delete(dependencyId);
  }

  #prune(now: Date): void {
    for (const [dependencyId, entry] of this.#entries) {
      if (Date.parse(entry.requirement.expiresAt) <= now.getTime()) {
        this.#entries.delete(dependencyId);
      }
    }
  }
}
