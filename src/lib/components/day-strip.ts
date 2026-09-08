/**
 * The size and snap behavior shared by every day-strip cell, so a consumer
 * of `DayStrip.svelte` only adds its own colors and state classes on top
 * rather than repeating the shape (and tripping the duplicate-code gate).
 */
export const DAY_STRIP_CELL =
	'flex h-16 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg snap-center';

/**
 * What one `DayStrip` cell's snippet receives: the day itself, plus the
 * wiring it must attach to its own interactive element (button or link).
 *
 * Kept in a plain module rather than a `<script module>` block in
 * `DayStrip.svelte`: a type exported from a Svelte component's module
 * script does not resolve for the type-aware ESLint rules when imported
 * back into another component, so a consumer's destructured snippet
 * parameters read as `any`.
 */
export type DayStripCellProps = {
	iso: string;
	isToday: boolean;
	index: number;
	attach: (el: HTMLElement) => void;
	onkeydown: (event: KeyboardEvent) => void;
};
