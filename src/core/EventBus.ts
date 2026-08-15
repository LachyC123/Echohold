import {
  selectEvents,
  type DomainEvent,
  type DomainEventName,
  type DomainEventPayloads,
  type EventEnvelope,
} from './events';

type Listener<K extends DomainEventName> = (event: DomainEvent<K>) => void;

/**
 * Typed publish/subscribe bus plus a bounded event journal.
 *
 * The journal is what the timeline review and the fracture analysis read. It
 * holds compact typed records rather than world snapshots, which keeps the
 * memory cost of a 60-second loop trivial (design document section 29).
 *
 * `dispose()` must remove every listener - a leaked subscription across a
 * scenario restart is the single most likely source of duplicated actors and
 * doubled sounds, so the restart regression test asserts the count is zero.
 */
export class EventBus {
  private readonly listeners = new Map<DomainEventName, Set<Listener<never>>>();
  private journal: DomainEvent[] = [];
  private journalEnabled = true;

  constructor(private readonly maxJournalEntries = 6000) {}

  on<K extends DomainEventName>(name: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(name, listener);
  }

  once<K extends DomainEventName>(name: K, listener: Listener<K>): () => void {
    const off = this.on(name, (event) => {
      off();
      listener(event);
    });
    return off;
  }

  off<K extends DomainEventName>(name: K, listener: Listener<K>): void {
    this.listeners.get(name)?.delete(listener as Listener<never>);
  }

  emit<K extends DomainEventName>(
    name: K,
    envelope: EventEnvelope,
    payload: DomainEventPayloads[K],
  ): DomainEvent<K> {
    const event = { ...envelope, name, payload } as DomainEvent<K>;

    if (this.journalEnabled) {
      this.journal.push(event as DomainEvent);
      // Drop the oldest half at once rather than shifting every emit.
      if (this.journal.length > this.maxJournalEntries) {
        this.journal = this.journal.slice(this.journal.length >> 1);
      }
    }

    const set = this.listeners.get(name);
    if (set) {
      // Copy first: a listener may unsubscribe itself during dispatch.
      for (const listener of Array.from(set)) {
        (listener as Listener<K>)(event);
      }
    }
    return event;
  }

  /** Chronological journal for the current loop. */
  getJournal(): readonly DomainEvent[] {
    return this.journal;
  }

  find<K extends DomainEventName>(name: K): DomainEvent<K>[] {
    return selectEvents(this.journal, name);
  }

  /** Called at every loop reset; listeners survive, history does not. */
  clearJournal(): void {
    this.journal = [];
  }

  setJournalEnabled(enabled: boolean): void {
    this.journalEnabled = enabled;
  }

  /** Total live subscriptions - asserted by the restart regression test. */
  listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  dispose(): void {
    this.listeners.clear();
    this.journal = [];
  }
}
