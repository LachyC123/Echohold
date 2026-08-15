# ECHOHOLD

Time-loop automation, fortress defence and progression strategy for mobile browsers.

You are the Warden of a ruined fortress caught in a one-minute time fracture. Every
attempt leaves behind an **Echo** — a pale version of your previous self that repeats
exactly what you did. Solving a scenario means authoring a small clockwork
performance out of several copies of yourself.

Built from `ECHOHOLD_BROWSER_MOBILE_MASTER_PLAN.docx`, which is the source of truth
for the design.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Typecheck, then a production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest suite over the pure simulation systems |
| `npm run typecheck` | `tsc --noEmit` |

Play it in a **portrait** viewport. On a desktop browser, open the device toolbar and
pick a phone — the game asks you to rotate in landscape, by design.

## Controls

**Touch (primary).** The scheme is semantic rather than positional, which is what
makes a recording survive replay in a slightly different world.

| Input | Meaning |
| --- | --- |
| Tap open ground | Move there |
| Tap a station | Do the sensible thing with it — take, deliver, work, fire or ring |
| Tap a destination while carrying | Deliver what you are holding |
| Press and hold a station | Radial menu of every action it supports, with reasons for the ones it does not |
| Drag and release | Move without performing the destination's default action |
| Pinch | Snap between the two approved zoom levels |
| Two-finger tap, or the ‖ button | Pause |
| The ↺ button | Restart the loop (one confirming tap) |

**Desktop, for development.** Click to command, `Space` for the nearest station,
`Esc` to pause, `R` to restart, `G` to toggle the navigation grid overlay.

## What is playable today

Milestones 0 through 2 of the build plan — through the **First Playable** review gate.

- **The Broken Gate**, complete: tutorial, deterministic raid, bronze/silver/gold
  objectives, failure diagnosis, restart, victory, medal and reward.
- **Record and replay.** Up to four Echoes, kept, overwritten, renamed or discarded.
- **The fortress hub**, which visibly rebuilds its gatehouse when you stabilise the
  minute, and remembers it across reloads.
- **Timeline review** with playback speeds, jump-to-first-fracture, and one
  plain-language cause per command.
- **Settings**: volumes, comfort options, difficulty assists, and save
  export/import/reset.

Not yet built: chapters 2–5, the remaining Chapter 1 scenarios, relics, residents and
the Echo ability tree beyond the first choice. See *Known limitations* below.

## How to solve The Broken Gate

The scenario is tuned so that neither repairing nor defending alone is enough:

| Plan | Outcome |
| --- | --- |
| Do nothing | The gate falls around 54s |
| Repair only | 41 raider + 72 ram damage — the gate still falls |
| Repair, ring the bell, but never fire | The ram is unanswered |
| Repair, ring the bell, kill the ram | The gate holds — bronze |

The intended three loops:

1. Take timber → carpenter bench → work → carry both planks to the gate and mend it.
2. Keep that as an Echo. Take a bolt from the armoury and load the ballista.
3. Keep that too. Now ring the Hour Bell around 36s to stall the raiders, then
   operate the ballista as the Ram Crew arrives at 48s.

Other solutions are possible; nothing hard-codes this route.

## Architecture

The rule is a hard separation between **simulation** and **presentation**.

```
src/
  core/        EventBus, FixedStepClock, SeededRng, IdRegistry, types, events
  config/      gameConfig (palette, depths, framing), balance (every tuning number)
  data/        items, stations, enemies, scenarios/, navGrid, validation
  systems/     ScenarioSimulation and the rule systems it owns
  entities/    ActorView, StationView, EnemyView — draw only, never decide
  scenes/      Boot, Title, Hub, Scenario, UI, TimelineReview
  ui/          ActiveHud, EchoRoster, TimelineView, RadialMenu, Button, SettingsPanel
  art/         TextureFactory — the whole art set, generated at boot
tests/         Vitest over the simulation, in plain Node
```

Load-bearing decisions:

- **`ScenarioSimulation` imports no Phaser.** The scene advances it on a fixed step
  and renders whatever it says is true. That is what lets the batch validation test
  run a hundred replays in Node and compare them tick for tick.
- **30 authoritative ticks per second.** Rendering interpolates; rules never see a
  frame delta. A tab-restore stall is clamped rather than replayed.
- **No `Math.random()` in the rules** — a test asserts this. Every stochastic choice
  draws from a seeded generator.
- **Rules emit domain events; presentation subscribes.** Nothing in the render layer
  may grant a resource or finish a task. The failure diagnosis reads the same event
  stream the objectives do, so a review message cannot contradict the rules.
- **Recordings are semantic.** A command stores a stable target ID and an intent, not
  a pointer coordinate, so an Echo re-paths rather than walking into a wall.
- **Art is generated, not downloaded.** One palette, one shape language, no binary
  assets, and no possible silent missing-asset failure.

## Tests

```bash
npm test
```

67 tests covering the systems the design document calls out in section 28:
recorder ordering and interruption, playback and drift, interaction reservations,
item conservation, objective transitions and idempotency, failure analysis,
save round-trip and corruption recovery, the full restart regression, scenario
validation, and batch determinism — a hundred replays and five different frame
patterns, including a four-second stall, all producing an identical journal.

## Known limitations

- Only one scenario exists. The hub lists two more as visibly locked.
- The Echo ability tree offers its first choice; Hand-off and Swift Boots are
  recorded in the save but do not yet change the simulation.
- Relics, residents and the Chronicle are designed but not implemented.
- Art is final-facing in style but is a generated placeholder set, not a hand-drawn
  pass. Audio is synthesised rather than composed.
- The PWA offline shell is registered in production builds only and has not been
  tested against a real install-and-fly-offline cycle.

## The single most valuable next improvement

Chapter 1's second scenario, *The Dry Well*. Everything needed to add it is now data —
stations, recipes, lanes, objectives, tutorial steps — and building one more scenario
through that path is the real test of whether the content framework holds before any
more systems are added.
