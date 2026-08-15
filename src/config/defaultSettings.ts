import type { PlayerSettings } from '../core/types';

/**
 * Defaults chosen so a first-time player on a phone gets the intended
 * experience with no visit to a settings screen: tap-to-command, motion on,
 * assists off. Every assist can be toggled at any time and none of them gate
 * story, upgrades or medals (design document section 30).
 */
export const DEFAULT_SETTINGS: PlayerSettings = {
  musicVolume: 0.6,
  effectsVolume: 0.85,
  hapticsEnabled: true,
  reduceMotion: false,
  highContrast: false,
  largeText: false,
  slowSimulation: false,
  earlyThreatMarkers: false,
  extendedTimeouts: false,
  autoPauseOnFracture: false,
  quality: 'AUTO',
  controlScheme: 'TAP_TO_COMMAND',
};

export function cloneSettings(settings: PlayerSettings): PlayerSettings {
  return { ...settings };
}
