export type ButtonVariant =
	'default' | 'secondary' | 'ghost' | 'outline' | 'quiet' | 'destructive' | 'destructive-outline';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'icon-round' | 'icon-round-sm';

export const BUTTON_BASE =
	'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[transform,opacity,box-shadow] duration-150 ease-out active:not-disabled:scale-[0.96] disabled:pointer-events-none disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';

// Filled (`default`) buttons get an explicit disabled treatment rather than opacity:
// fading a filled button's background and foreground together toward the page background
// collapses their contrast regardless of the starting colors (see issue #46). It reuses
// the `secondary` pair — a light, muted fill with dark text — precisely because it reads
// as unmistakably "off" against the dark-green enabled fill from its lightness alone, not
// from a color a person has to discriminate or a hover/cursor a touch screen doesn't have.
// `background-color` and `color` are deliberately absent from BUTTON_BASE's transition
// list (below): animating between two color pairs necessarily crosses low-contrast
// intermediate frames in either direction, disabled-to-enabled included, and a control
// whose contrast matters can't afford that mid-transition dip (issue #46 regression).
// `transform`, `opacity` and `box-shadow` stay animated since neither can produce a
// contrast violation between two already-accessible states.
// The other variants sit on transparent/light backgrounds already, where a plain opacity
// fade keeps its target ratio.
export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
	default:
		'bg-primary text-primary-foreground hover:opacity-90 disabled:bg-secondary disabled:text-secondary-foreground',
	secondary: 'bg-secondary text-secondary-foreground hover:bg-muted disabled:opacity-50',
	ghost: 'text-foreground hover:bg-secondary disabled:opacity-50',
	outline: 'border border-border bg-card text-foreground hover:bg-secondary disabled:opacity-50',
	quiet:
		'bg-transparent text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50',
	// Filled red is for confirming the irreversible thing, never for offering it: the
	// button that starts a deletion is the outline, so the weight arrives only once
	// the question has been asked and the answer is the one that cannot be taken back.
	destructive:
		'bg-destructive text-destructive-foreground hover:opacity-90 disabled:bg-secondary disabled:text-secondary-foreground',
	'destructive-outline':
		'border border-destructive/30 bg-card text-destructive hover:bg-destructive/10 disabled:opacity-50'
};

export const BUTTON_SIZES: Record<ButtonSize, string> = {
	default: 'h-11 px-4 rounded-xl text-sm',
	sm: 'h-9 px-3 rounded-lg text-sm',
	lg: 'h-12 px-5 rounded-2xl text-base',
	icon: 'size-11 rounded-xl',
	'icon-round': 'size-11 rounded-full',
	// One step down from `icon-round` on the visible circle (44px -> 36px, the
	// same drop `sm`'s height takes from `default`), while the button's own box
	// stays the full 44px so the tap target never shrinks with it. `p-1`
	// insets the painted background by 4px on every side and `bg-clip-content`
	// (not the `padding-box` default) keeps that inset transparent instead of
	// filled, so the circle drawn on screen is the smaller content box and the
	// full box beneath it still answers a tap out to its true 44px edge.
	'icon-round-sm': 'size-11 rounded-full p-1 bg-clip-content'
};
