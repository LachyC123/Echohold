import { describe, expect, it } from 'vitest';
import { IdRegistry } from '../src/core/IdRegistry';
import { CommandRecorder } from '../src/systems/CommandRecorder';
import { createActor } from '../src/systems/world';
import { issueAndSettle, makeSimulation, stepTicks } from './helpers';

describe('CommandRecorder', () => {
  it('creates ordered commands with stable, unique IDs', () => {
    const recorder = new CommandRecorder(new IdRegistry(), 'test');
    recorder.start();

    recorder.record(0, 'TAKE', { targetId: 'timber_stack' });
    recorder.record(40, 'DELIVER', { targetId: 'carpenter_bench' });
    recorder.record(120, 'WORK', { targetId: 'carpenter_bench' });

    const track = recorder.build(1800, 0, 0, 'Wood');
    const ids = track.commands.map((c) => c.id);

    expect(track.commands.map((c) => c.issuedTick)).toEqual([0, 40, 120]);
    expect(new Set(ids).size).toBe(3);
    expect(track.label).toBe('Wood');
    expect(track.durationTicks).toBe(1800);
  });

  it('records nothing before start or after stop', () => {
    const recorder = new CommandRecorder(new IdRegistry(), 'test');
    expect(recorder.record(0, 'TAKE', { targetId: 'x' })).toBeNull();

    recorder.start();
    expect(recorder.record(0, 'TAKE', { targetId: 'x' })).not.toBeNull();

    recorder.stop();
    expect(recorder.record(10, 'TAKE', { targetId: 'y' })).toBeNull();
    expect(recorder.commandCount).toBe(1);
  });

  it('stores how long an interrupted command actually ran', () => {
    const recorder = new CommandRecorder(new IdRegistry(), 'test');
    recorder.start();

    const first = recorder.record(0, 'MOVE_TO', { point: { x: 100, y: 100 } })!;
    recorder.noteCommandStarted(first, 0);

    // The player changed their mind 30 ticks in.
    recorder.noteCommandInterrupted(30);
    const second = recorder.record(30, 'TAKE', { targetId: 'timber_stack' })!;
    recorder.noteCommandStarted(second, 30);
    recorder.noteCommandFinished(70);

    const track = recorder.build(1800, 0, 0);
    expect(track.commands[0]!.maxRunTicks).toBe(30);
    // The command that ended naturally carries no truncation.
    expect(track.commands[1]!.maxRunTicks).toBeUndefined();
  });

  it('leaves a queued command untouched when the one before it completes', () => {
    const recorder = new CommandRecorder(new IdRegistry(), 'test');
    recorder.start();

    const take = recorder.record(0, 'TAKE', { targetId: 'armoury_rack' })!;
    recorder.noteCommandStarted(take, 0);
    // The player lines up the delivery while the pickup is still running.
    const deliver = recorder.record(40, 'DELIVER', { targetId: 'ballista' })!;
    recorder.noteCommandFinished(60);
    recorder.noteCommandStarted(deliver, 60);
    recorder.noteCommandFinished(120);

    const track = recorder.build(1800, 0, 0);
    // Neither was abandoned, so neither is truncated on replay.
    expect(track.commands.map((c) => c.maxRunTicks)).toEqual([undefined, undefined]);
    expect(track.commands.map((c) => c.type)).toEqual(['TAKE', 'DELIVER']);
  });

  it('samples the live route without unbounded growth', () => {
    const recorder = new CommandRecorder(new IdRegistry(), 'test');
    const actor = createActor('warden', 'WARDEN', { x: 0, y: 0 }, 120, 0);
    recorder.start();
    const command = recorder.record(0, 'MOVE_TO', { point: { x: 400, y: 400 } })!;
    recorder.noteCommandStarted(command, 0);

    for (let tick = 1; tick <= 3000; tick++) {
      actor.position = { x: tick % 400, y: tick % 400 };
      recorder.sample(tick, actor);
    }

    const track = recorder.build(3000, 0, 0);
    const samples = track.commands[0]!.pathSamples ?? [];
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.length).toBeLessThanOrEqual(220);
  });

  it('records the semantic intent of a tap, not its coordinates', () => {
    const sim = makeSimulation();
    const stack = sim.getWorld().stations.get('timber_stack')!;

    const resolution = sim.resolveTap({ x: stack.position.x, y: stack.position.y });
    expect(resolution?.type).toBe('TAKE');
    expect(resolution?.targetId).toBe('timber_stack');
    expect(resolution?.itemDefinitionId).toBe('timber');

    sim.issue(resolution!);
    const recorded = sim.recorder.peek()[0]!;
    expect(recorded.targetId).toBe('timber_stack');
    // A stable target ID, so replay survives a slightly different world.
    expect(recorded.point).toBeUndefined();
  });

  it('resolves a tap differently as the world state changes', () => {
    const sim = makeSimulation();
    const bench = sim.getWorld().stations.get('carpenter_bench')!;
    const warden = sim.getWarden();

    // Empty bench, empty hands: nothing to do but walk there.
    expect(sim.resolveTap(bench.position)?.type).toBe('MOVE_TO');

    // Carrying timber: the bench wants it.
    warden.carrying = 'timber';
    expect(sim.resolveTap(bench.position)?.type).toBe('DELIVER');

    // Inputs present, hands empty: the bench is ready to be worked.
    warden.carrying = null;
    bench.inputs['timber'] = 1;
    expect(sim.resolveTap(bench.position)?.type).toBe('WORK');

    // Finished goods waiting: take them.
    bench.inputs['timber'] = 0;
    bench.outputs['plank'] = 2;
    expect(sim.resolveTap(bench.position)?.type).toBe('TAKE');
  });

  it('leaves a recording that replays into the same journal', () => {
    const sim = makeSimulation();
    issueAndSettle(sim, 'TAKE', 'timber_stack');
    issueAndSettle(sim, 'DELIVER', 'carpenter_bench');
    stepTicks(sim, 30);

    const commands = sim.recorder.peek();
    expect(commands).toHaveLength(2);
    expect(commands[0]!.type).toBe('TAKE');
    expect(commands[1]!.type).toBe('DELIVER');
    expect(commands[0]!.issuedTick).toBeLessThan(commands[1]!.issuedTick);
  });
});
