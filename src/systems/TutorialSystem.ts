import type { EventBus } from '../core/EventBus';
import type { ScenarioDefinition, TutorialStep } from '../core/types';

/**
 * Drives the opening tutorial (design document section 12).
 *
 * Rules this enforces so the tutorial cannot become a wall of text:
 *   - one step is live at a time, and every step is at most two short lines;
 *   - the loop timer holds while a mandatory first-use instruction is up;
 *   - completion is observed from real domain events, never from a timer, so
 *     the panel can never claim the player did something they did not.
 */
export class TutorialSystem {
  private steps: TutorialStep[] = [];
  private index = 0;
  private acknowledged = false;
  private readonly unsubscribers: Array<() => void> = [];
  private completedIds = new Set<string>();

  constructor(
    private readonly bus: EventBus,
    private readonly scenario: ScenarioDefinition,
    private readonly enabled: boolean,
  ) {
    if (!this.enabled) return;
    this.subscribe();
  }

  /** Called at the start of each run to pick that run's steps. */
  beginRun(runNumber: number): void {
    if (!this.enabled) {
      this.steps = [];
      return;
    }
    this.steps = (this.scenario.tutorialSteps ?? []).filter(
      (step) => step.runNumber === runNumber && !this.completedIds.has(step.id),
    );
    this.index = 0;
    this.acknowledged = false;
  }

  get current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  get isComplete(): boolean {
    return this.index >= this.steps.length;
  }

  /**
   * True while a mandatory instruction should hold the loop timer.
   *
   * The hold exists to give the player time to *read*, and it is released the
   * moment they act - not when the instructed action finishes. Waiting for
   * completion would deadlock: the first step asks the Warden to move, and the
   * Warden cannot move while the simulation is held.
   */
  get shouldHoldTimer(): boolean {
    const step = this.current;
    return step !== null && step.pausesTimer && !this.acknowledged;
  }

  /** Any command from the player counts as having read the current panel. */
  notePlayerCommand(): void {
    if (this.current) this.acknowledged = true;
  }

  /** The player tapped "Got it" on an acknowledgement step. */
  acknowledge(): void {
    const step = this.current;
    if (!step) return;
    this.acknowledged = true;
    if (step.completeOn.kind === 'ACKNOWLEDGED') this.advance();
  }

  private advance(): void {
    const step = this.current;
    if (step) this.completedIds.add(step.id);
    this.index += 1;
    this.acknowledged = false;
  }

  private subscribe(): void {
    const check = (matches: (step: TutorialStep) => boolean) => {
      const step = this.current;
      if (!step) return;
      if (matches(step)) this.advance();
    };

    this.unsubscribers.push(
      this.bus.on('ACTOR_MOVED', () =>
        check((step) => step.completeOn.kind === 'MOVE_ANYWHERE'),
      ),
      this.bus.on('ITEM_TAKEN', (event) =>
        check(
          (step) =>
            step.completeOn.kind === 'ITEM_TAKEN' &&
            step.completeOn.itemDefinitionId === event.payload.itemDefinitionId,
        ),
      ),
      this.bus.on('ITEM_DELIVERED', (event) =>
        check(
          (step) =>
            step.completeOn.kind === 'ITEM_DELIVERED' &&
            step.completeOn.stationId === event.payload.stationId,
        ),
      ),
      this.bus.on('RECIPE_COMPLETED', (event) =>
        check(
          (step) =>
            step.completeOn.kind === 'RECIPE_COMPLETED' &&
            step.completeOn.stationId === event.payload.stationId,
        ),
      ),
      this.bus.on('SIGNAL_EMITTED', () =>
        check((step) => step.completeOn.kind === 'SIGNAL_EMITTED'),
      ),
      this.bus.on('LOOP_ENDED', () => check((step) => step.completeOn.kind === 'LOOP_ENDED')),
    );
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
  }
}
