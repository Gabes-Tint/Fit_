export function uid(prefix = '') {
	return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayISO(d = new Date()) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function addDaysISO(iso: string, days: number) {
	const dt = parseISODate(iso);
	dt.setDate(dt.getDate() + days);
	return todayISO(dt);
}

export function parseISODate(iso: string) {
	// A malformed string must not become an Invalid Date: NaN would propagate and fail silently.
	// A string with too few '-'-separated parts leaves y/m/d undefined, and
	// Number.isFinite(undefined) is already false, so the check below alone
	// covers both a missing part and one that parses to NaN.
	const [y, m, d] = iso.split('-').map(Number);
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
		return new Date(1970, 0, 1);
	}
	return new Date(y, m - 1, d);
}

export function round1(n: number) {
	return Math.round(n * 10) / 10;
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function weekdayShort(iso: string): string {
	return WEEKDAYS_SHORT[parseISODate(iso).getDay()] ?? '';
}

const WEEKDAYS_LONG = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
] as const;

export function weekdayLong(iso: string): string {
	return WEEKDAYS_LONG[parseISODate(iso).getDay()] ?? '';
}

export function monthDay(iso: string) {
	return parseISODate(iso).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric'
	});
}

export function lastNDates(n: number, end = todayISO()) {
	const out: string[] = [];
	for (let i = n - 1; i >= 0; i--) out.push(addDaysISO(end, -i));
	return out;
}

export function startOfWeek(iso: string) {
	const dt = parseISODate(iso);
	const day = dt.getDay();
	const mondayOffset = day === 0 ? -6 : 1 - day;
	return addDaysISO(iso, mondayOffset);
}
