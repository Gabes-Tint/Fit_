/**
 * The size and snap behavior shared by every day-strip cell, so a consumer
 * of `DayStrip.svelte` only adds its own colors and state classes on top
 * rather than repeating the shape (and tripping the duplicate-code gate).
 */
export const DAY_STRIP_CELL =
	'flex h-16 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg snap-center';
