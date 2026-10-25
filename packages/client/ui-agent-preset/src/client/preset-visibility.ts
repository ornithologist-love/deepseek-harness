/**
 * Whether this deployment leaves a preset's presentation to another surface.
 *
 * The registry's own `hiddenPresetPrefixes` removes presets from the roster
 * this browser lists; this one keeps the roster intact and hides only the
 * package's controls for Sessions already composed with such a preset.
 */

/**
 * Test one preset id against the configured prefixes.
 * @param id - durable preset id the Session records.
 * @param prefixes - configured prefixes from the page bootstrap.
 * @returns true when any prefix matches the id from its first character.
 */
export function hidesPreset(id: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => id.startsWith(prefix))
}
