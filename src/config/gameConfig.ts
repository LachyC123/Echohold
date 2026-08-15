/** Authoritative simulation rate. Rendering interpolates; rules never do. */
export const TICKS_PER_SECOND = 30;

/** A scenario loop is one minute of the fracture. */
export const LOOP_SECONDS = 60;
export const LOOP_TICKS = LOOP_SECONDS * TICKS_PER_SECOND;

/**
 * Design resolution.
 *
 * The width is fixed so world authoring stays stable, and the height is
 * derived from the device's own aspect at boot. Phones range from 16:9 to
 * beyond 20:9; a single fixed design height would letterbox away nearly a
 * fifth of a tall screen, which is exactly the space the courtyard wants.
 *
 * The height is only recomputed on a fresh boot. An address bar sliding in and
 * out then costs a few pixels of letterbox rather than a whole re-layout,
 * which is a much better trade than UI that jumps while the player is playing.
 */
export const DESIGN_WIDTH = 480;

/** Reference height, used where a static default is genuinely needed. */
export const DESIGN_HEIGHT = 960;

const MIN_VIEW_HEIGHT = 760;
const MAX_VIEW_HEIGHT = 1140;

export function computeViewHeight(
  innerWidth = typeof window === 'undefined' ? 480 : window.innerWidth,
  innerHeight = typeof window === 'undefined' ? 960 : window.innerHeight,
): number {
  if (innerWidth <= 0 || innerHeight <= 0) return DESIGN_HEIGHT;
  const aspect = innerHeight / innerWidth;
  return Math.round(Math.min(MAX_VIEW_HEIGHT, Math.max(MIN_VIEW_HEIGHT, DESIGN_WIDTH * aspect)));
}

/** World units per navigation cell. */
export const NAV_CELL_SIZE = 24;

/** Fill rate, not CPU, is the phone bottleneck; cap the backing store. */
export const MAX_PIXEL_RATIO_HIGH = 2;
export const MAX_PIXEL_RATIO_LOW = 1;

export const SceneKeys = {
  Boot: 'BootScene',
  Title: 'TitleScene',
  Hub: 'HubScene',
  Scenario: 'ScenarioScene',
  TimelineReview: 'TimelineReviewScene',
  UI: 'UIScene',
} as const;

export type SceneKey = (typeof SceneKeys)[keyof typeof SceneKeys];

/**
 * Palette roles from the visual bible (section 17). Colours are referenced by
 * role, never by literal hex at the call site, so a later art pass can retune
 * the whole game from one table.
 */
export const Palette = {
  stoneDark: 0x2b3744,
  stoneBase: 0x46586b,
  stoneLight: 0x647b91,
  groundBase: 0x5c5347,
  groundLight: 0x6e6355,
  timber: 0x8a5f3c,
  timberDark: 0x5d3f28,
  ochre: 0xb98b47,
  wardenCream: 0xf4e6cd,
  wardenAccent: 0xd4674a,
  echoPale: 0xaee6f0,
  echoDeep: 0x5fa9bd,
  readyGold: 0xf0b357,
  blockedRust: 0x9c5544,
  danger: 0xc03a25,
  rewardGold: 0xffd88a,
  timeTeal: 0x39c3c9,
  timeViolet: 0x2a1a3d,
  ink: 0x141a22,
  inkSoft: 0x1e2733,
  parchment: 0xe8dcc0,
  muted: 0x90a2b5,
} as const;

/** Echo track tint ramp - pale cyan family, distinguishable at thumb size. */
export const ECHO_COLOURS = [0xaee6f0, 0x8fd4e8, 0xb9c9f0, 0x9fe8d8, 0xc9bbf0, 0x8fc0e0] as const;

export const Depth = {
  ground: 0,
  groundDecal: 5,
  pathOverlay: 10,
  stationBase: 20,
  item: 30,
  actor: 40,
  actorCarry: 45,
  stationTop: 50,
  effect: 60,
  telegraph: 65,
  worldLabel: 70,
  hud: 100,
  overlay: 200,
} as const;

/** Development-only affordances; stripped from production builds. */
export const IS_DEV = import.meta.env.DEV;
