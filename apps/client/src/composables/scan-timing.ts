/**
 * The longest gap between two keystrokes of one scan (issue #214). Hand
 * typing is far slower; Bluetooth wedges can be slow or bursty, so this is
 * generous. Kept free of imports so pure helpers can share it (#323).
 */
export const SCAN_KEY_INTERVAL_MS = 200;
