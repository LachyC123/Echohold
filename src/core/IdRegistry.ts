/**
 * Deterministic ID minting.
 *
 * Runtime IDs must be reproducible: two runs of the same scenario with the
 * same command stream have to produce byte-identical journals, so a random or
 * timestamp-based ID would break the batch determinism test. Counters are
 * namespaced and reset with the scenario.
 */
export class IdRegistry {
  private counters = new Map<string, number>();
  private readonly known = new Set<string>();

  /** e.g. next('echo') -> "echo-1", "echo-2", ... */
  next(namespace: string): string {
    const n = (this.counters.get(namespace) ?? 0) + 1;
    this.counters.set(namespace, n);
    const id = `${namespace}-${n}`;
    this.known.add(id);
    return id;
  }

  /** Registers an authored ID and reports a collision instead of hiding it. */
  register(id: string): boolean {
    if (this.known.has(id)) return false;
    this.known.add(id);
    return true;
  }

  has(id: string): boolean {
    return this.known.has(id);
  }

  release(id: string): void {
    this.known.delete(id);
  }

  reset(): void {
    this.counters.clear();
    this.known.clear();
  }
}
