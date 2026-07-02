// Ported verbatim from gm-protocol/src/lib/gmDetection.ts so the napplet inbox
// matches the reference app's notion of a "GM" exactly. Do not loosen this regex
// without a matching change there — the two must agree on what counts as a GM.

/**
 * Checks if a message contains "GM" or "good morning" with proper word
 * boundaries. Avoids false positives from URLs or words that merely contain
 * these letters (e.g. "magma", "imgmt").
 *
 * @param content - The message content to check
 * @returns true if the message contains a valid GM
 */
export function containsGM(content: string): boolean {
  // Word boundary pattern that matches:
  // - Start of string or whitespace/punctuation before
  // - The target token (case insensitive): `gm` OR the phrase `good morning`
  // - End of string or whitespace/punctuation after
  const gmPattern =
    /(?:^|[\s.,!?;:'"\-—()\[\]{}])(gm|good\s+morning)(?=$|[\s.,!?;:'"\-—()\[\]{}])/i;

  return gmPattern.test(content);
}

/**
 * Validates that a GM message contains "GM" or "good morning" for publishing.
 * Same logic as containsGM but explicitly for validation purposes.
 */
export function isValidGMMessage(content: string): boolean {
  return containsGM(content);
}
