import { describe, expect, it } from 'vitest';
import { buildAlexProfile } from './demo-seed';
import { logFromFood } from './log-entry';
import { emptyProfile } from './profile';
import {
	exportCsv,
	exportJson,
	MFP_IMPORT_LIMIT,
	mfpRowsToLogItems,
	parseMfpCsv
} from './export-data';
import { SCHEMA_VERSION, stateFormat } from './state-document';
import type { LogItem, Profile, TendState } from './types';
import {
	DEFAULT_LEFT_HANDED,
	DEFAULT_LOAD_UNIT,
	DEFAULT_REST_SECONDS,
	DEFAULT_UNITS,
	ZERO_MICROS
} from './types';
import { todayISO } from './utils';

const state: TendState = {
	onboarded: true,
	activeProfileId: 'p1',
	profiles: [{ ...emptyProfile({ name: 'Alex' }), id: 'p1' }],
	weekPlan: [],
	pantry: [],
	routines: [],
	trainingPlan: [],
	workouts: [],
	activeWorkout: null,
	loadUnit: DEFAULT_LOAD_UNIT,
	restSeconds: DEFAULT_REST_SECONDS,
	units: DEFAULT_UNITS,
	leftHanded: DEFAULT_LEFT_HANDED
};

/**
 * Stated here, not derived from the module, so a heading that moves, disappears
 * or changes spelling is a deliberate edit in two places.
 */
const CSV_HEADER =
	'date,meal,name,brand,servings,serving_label,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,potassium_mg,iron_mg,b12_mcg,provenance,source';

/**
 * One entry with a distinct, memorable value in every exported column, so the
 * expected row reads field by field and a column reading the wrong property
 * shows up as a swapped value.
 */
function pinnedEntry(overrides: Partial<LogItem> = {}): LogItem {
	return {
		...logFromFood({
			foodId: 'egg-large',
			servings: 2.5,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'text'
		}),
		name: 'Oat porridge',
		brand: 'Oatly',
		servingLabel: '1 bowl',
		kcal: 321,
		protein: 22.5,
		carbs: 33.5,
		fat: 11.5,
		micros: { ...ZERO_MICROS, fiber: 7, sodium: 640, potassium: 410, iron: 3.2, vitaminB12: 1.4 },
		provenance: 'lab',
		...overrides
	};
}

const PINNED_ROW =
	'2026-06-01,breakfast,Oat porridge,Oatly,2.5,1 bowl,321,22.5,33.5,11.5,7,640,410,3.2,1.4,lab,text';

function profileWith(...log: LogItem[]): Profile {
	return { ...emptyProfile({ name: 'Casey' }), log };
}

function csvRows(profile: Profile) {
	return exportCsv(profile).split('\n').slice(1);
}

describe('exportJson', () => {
	it('stamps the format and export time', () => {
		const parsed = JSON.parse(exportJson(state)) as { format: string; exportedAt: string };
		expect(parsed.format).toBe(stateFormat(SCHEMA_VERSION));
		expect(parsed.exportedAt).toBeTruthy();
	});

	// An export that says `tend.v1` while carrying a later shape describes itself
	// wrongly, and whoever opens it next has no way to tell.
	it('carries the schema version of the document it exported', () => {
		const parsed = JSON.parse(exportJson(state)) as { schemaVersion: number; format: string };
		expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
		expect(parsed.format).toBe(`tend.v${parsed.schemaVersion}`);
	});

	it('carries the profiles through', () => {
		const parsed = JSON.parse(exportJson(state)) as TendState;
		expect(parsed.profiles).toHaveLength(1);
	});
});

describe('exportCsv', () => {
	it('emits a header plus one row per log entry', () => {
		const profile = buildAlexProfile();
		const lines = exportCsv(profile).split('\n');
		expect(lines.length).toBe(profile.log.length + 1);
	});

	it('emits only the named columns for an empty log', () => {
		expect(exportCsv(emptyProfile({ name: 'Empty' }))).toBe(CSV_HEADER);
	});

	it('writes every column of an entry under its own heading', () => {
		expect(csvRows(profileWith(pinnedEntry()))).toEqual([PINNED_ROW]);
	});

	it('leaves brand and provenance empty when the entry states neither', () => {
		const bare = pinnedEntry({ brand: undefined, provenance: undefined });
		expect(csvRows(profileWith(bare))).toEqual([
			'2026-06-01,breakfast,Oat porridge,,2.5,1 bowl,321,22.5,33.5,11.5,7,640,410,3.2,1.4,,text'
		]);
	});

	it('orders the rows by date, oldest first', () => {
		const rows = csvRows(
			profileWith(
				pinnedEntry({ date: '2026-06-03', name: 'Third' }),
				pinnedEntry({ date: '2026-06-01', name: 'First' }),
				pinnedEntry({ date: '2026-06-02', name: 'Second' })
			)
		);
		expect(rows.map((row) => row.split(',')[2])).toEqual(['First', 'Second', 'Third']);
	});

	it('orders the rows of one day by meal', () => {
		const rows = csvRows(
			profileWith(
				pinnedEntry({ meal: 'lunch' }),
				pinnedEntry({ meal: 'dinner' }),
				pinnedEntry({ meal: 'breakfast' })
			)
		);
		expect(rows.map((row) => row.split(',')[1])).toEqual(['breakfast', 'dinner', 'lunch']);
	});

	it('quotes a field containing a comma so the row does not split', () => {
		expect(csvRows(profileWith(pinnedEntry({ name: 'Rice, beans' })))).toEqual([
			PINNED_ROW.replace('Oat porridge', '"Rice, beans"')
		]);
	});

	it('doubles a quote inside a field rather than dropping it', () => {
		const awkward = pinnedEntry({ name: 'Dave\'s "Killer" Bread, sliced' });
		expect(csvRows(profileWith(awkward))[0]).toContain('"Dave\'s ""Killer"" Bread, sliced"');
	});

	// The exporter and importer are two halves of one escape hatch and must agree.
	it('writes an awkward name that reads back through the importer unchanged', () => {
		const awkward = pinnedEntry({ name: 'Dave\'s "Killer" Bread, sliced' });
		expect(parseMfpCsv(exportCsv(profileWith(awkward)))[0]).toEqual({
			date: '2026-06-01',
			meal: 'breakfast',
			name: 'Dave\'s "Killer" Bread, sliced',
			kcal: 321,
			protein: 22.5,
			carbs: 33.5,
			fat: 11.5
		});
	});
});

describe('parseMfpCsv', () => {
	const csv = [
		'Date,Meal,Name,Calories,Protein,Carbohydrates,Fat',
		'2026-06-01,Breakfast,Oatmeal,300,10,50,5',
		'2026-06-01,Lunch,Chicken salad,450,40,10,25'
	].join('\n');

	it('reads every food row', () => {
		expect(parseMfpCsv(csv)).toHaveLength(2);
	});

	it('reads the macros', () => {
		expect(parseMfpCsv(csv)[0]).toMatchObject({ kcal: 300, protein: 10, carbs: 50, fat: 5 });
	});

	it('keeps the row date', () => {
		expect(parseMfpCsv(csv)[0]?.date).toBe('2026-06-01');
	});

	it('lowercases the meal', () => {
		expect(parseMfpCsv(csv)[0]?.meal).toBe('breakfast');
	});

	it('skips the summary rows a diary export ends with', () => {
		const withSummary = [
			csv,
			'2026-06-01,Lunch,Totals,750,50,60,30',
			'2026-06-01,Lunch,Goal,2000,120,200,60',
			'2026-06-01,Lunch,Remaining,1250,70,140,30',
			'2026-06-01,Lunch,Foods,0,0,0,0'
		].join('\n');
		expect(parseMfpCsv(withSummary).map((row) => row.name)).toEqual(['Oatmeal', 'Chicken salad']);
	});

	// Only a name that opens with a summary word is a summary row; "Fage Total 0%" is a real food.
	it('keeps a food whose name merely contains a summary word', () => {
		const brandName = 'Date,Name,Calories\n2026-06-01,Fage Total 0%,120';
		expect(parseMfpCsv(brandName).map((row) => row.name)).toEqual(['Fage Total 0%']);
	});

	it('returns nothing for empty input', () => {
		expect(parseMfpCsv('')).toEqual([]);
	});

	it('returns nothing when there is no name column to key on', () => {
		expect(parseMfpCsv('Date,Calories\n2026-06-01,300')).toEqual([]);
	});

	it('falls back to today when the date is unusable', () => {
		const bad = 'Date,Name,Calories\nnot-a-date,Oatmeal,300';
		expect(parseMfpCsv(bad)[0]?.date).toBe(todayISO());
	});

	it('takes the day from a date cell that carries a time', () => {
		const stamped = 'Date,Name,Calories\n2026-06-01T08:30:00Z,Oatmeal,300';
		expect(parseMfpCsv(stamped)[0]?.date).toBe('2026-06-01');
	});

	it('finds the date column wherever it sits', () => {
		const nameFirst = 'Name,Date,Calories\nOatmeal,2026-06-01,300';
		expect(parseMfpCsv(nameFirst)[0]?.date).toBe('2026-06-01');
	});

	it('reads a quoted field containing a comma as one value', () => {
		const quoted = 'Date,Name,Calories\n2026-06-01,"Rice, beans",300';
		expect(parseMfpCsv(quoted)[0]?.name).toBe('Rice, beans');
	});

	it('reads an escaped quote inside a quoted field', () => {
		const quoted = 'Date,Name,Calories\n2026-06-01,"Dave\'s ""Killer"" Bread",300';
		expect(parseMfpCsv(quoted)[0]?.name).toBe('Dave\'s "Killer" Bread');
	});

	it('reads the last cell of a row without trailing characters', () => {
		const nameLast = 'Date,Calories,Name\n2026-06-01,300,Oatmeal';
		expect(parseMfpCsv(nameLast)[0]?.name).toBe('Oatmeal');
	});

	it('trims the space a pasted cell arrives with', () => {
		const padded = 'Date,Name,Calories\n2026-06-01,  Oatmeal  ,300';
		expect(parseMfpCsv(padded)[0]?.name).toBe('Oatmeal');
	});

	it('treats a non-numeric macro as zero', () => {
		const odd = 'Date,Name,Calories\n2026-06-01,Oatmeal,none';
		expect(parseMfpCsv(odd)[0]?.kcal).toBe(0);
	});

	it('falls back to today when there is no date column at all', () => {
		const noDate = 'Name,Calories\nOatmeal,300';
		expect(parseMfpCsv(noDate)[0]?.date).toBe(todayISO());
	});

	it('falls back to snack when there is no meal column at all', () => {
		const noMeal = 'Date,Name,Calories\n2026-06-01,Oatmeal,300';
		expect(parseMfpCsv(noMeal)[0]?.meal).toBe('snack');
	});

	it('strips units from numeric fields', () => {
		const withUnits = 'Date,Name,Calories\n2026-06-01,Oatmeal,300 kcal';
		expect(parseMfpCsv(withUnits)[0]?.kcal).toBe(300);
	});

	// A paste picked up from a page usually arrives wrapped in blank lines.
	it('ignores the blank and whitespace-only lines around a paste', () => {
		const padded = ['', '   ', 'Date,Name,Calories', '2026-06-01,Oatmeal,300', '', '  '].join('\n');
		expect(parseMfpCsv(padded).map((row) => row.name)).toEqual(['Oatmeal']);
	});

	it('ignores a truncated row that stops before the name cell', () => {
		const ragged = 'Date,Name,Calories\n2026-06-01';
		expect(parseMfpCsv(ragged)).toEqual([]);
	});

	// Pins the header-to-row column alignment splitCsv relies on: every field
	// lands under the header it was pasted under, across every column and every
	// row, not just the first one a test happens to check.
	it('keeps every column aligned with its header across every row', () => {
		const wide = [
			'Meal,Date,Name,Calories,Protein,Carbohydrates,Fat',
			'Breakfast,2026-06-01,Oatmeal,300,10,50,5',
			'Lunch,2026-06-01,Chicken salad,450,40,10,25',
			'Dinner,2026-06-01,Salmon,600,45,5,35'
		].join('\n');
		expect(parseMfpCsv(wide)).toEqual([
			{
				date: '2026-06-01',
				name: 'Oatmeal',
				meal: 'breakfast',
				kcal: 300,
				protein: 10,
				carbs: 50,
				fat: 5
			},
			{
				date: '2026-06-01',
				name: 'Chicken salad',
				meal: 'lunch',
				kcal: 450,
				protein: 40,
				carbs: 10,
				fat: 25
			},
			{
				date: '2026-06-01',
				name: 'Salmon',
				meal: 'dinner',
				kcal: 600,
				protein: 45,
				carbs: 5,
				fat: 35
			}
		]);
	});

	it('returns nothing for a paste that is only a header', () => {
		expect(parseMfpCsv('Date,Name,Calories')).toEqual([]);
	});

	it('finds the columns of a header whose cells are padded with spaces', () => {
		const padded = ' Date , Name , Calories \n2026-06-01,Oatmeal,300';
		expect(parseMfpCsv(padded)[0]).toMatchObject({
			date: '2026-06-01',
			name: 'Oatmeal',
			kcal: 300
		});
	});
});

describe('mfpRowsToLogItems', () => {
	// Parsed per test, not once while the suite is being collected: a collection
	// that throws reports no test results at all, and a mutation runner reading
	// those results sees a mutant nothing failed on rather than one that was
	// killed. Every import here has to run inside a test for that reason.
	const oatmeal = () =>
		parseMfpCsv(
			['Date,Meal,Name,Calories,Protein', '2026-06-01,Breakfast,Oatmeal,300,10'].join('\n')
		);

	it('maps one item per row', () => {
		expect(mfpRowsToLogItems(oatmeal(), () => 'id')).toHaveLength(1);
	});

	it('leaves imported items unmatched to the catalog', () => {
		expect(mfpRowsToLogItems(oatmeal(), () => 'id')[0]?.foodId).toBeNull();
	});

	it('zeroes micronutrients rather than inventing them', () => {
		expect(mfpRowsToLogItems(oatmeal(), () => 'id')[0]?.micros.fiber).toBe(0);
	});

	it('labels the serving as imported rather than inventing one', () => {
		expect(mfpRowsToLogItems(oatmeal(), () => 'id')[0]).toMatchObject({
			servingLabel: 'imported',
			source: 'manual'
		});
	});

	it('keeps a meal it recognizes', () => {
		const lunch = parseMfpCsv('Date,Meal,Name,Calories\n2026-06-01,Lunch,Soup,200');
		expect(mfpRowsToLogItems(lunch, () => 'id')[0]?.meal).toBe('lunch');
	});

	it('falls back to snack for an meal it does not know', () => {
		const odd = parseMfpCsv('Date,Meal,Name,Calories\n2026-06-01,Elevenses,Scone,200');
		expect(mfpRowsToLogItems(odd, () => 'id')[0]?.meal).toBe('snack');
	});

	it('caps a very large paste, keeping the rows from the top', () => {
		const many = Array.from({ length: MFP_IMPORT_LIMIT + 20 }, (_, i) => ({
			date: '2026-06-01',
			name: `Item ${i}`,
			meal: 'lunch',
			kcal: 100,
			protein: 1,
			carbs: 1,
			fat: 1
		}));
		const items = mfpRowsToLogItems(many, () => 'id');
		expect(items).toHaveLength(MFP_IMPORT_LIMIT);
		expect(items.at(-1)?.name).toBe(`Item ${MFP_IMPORT_LIMIT - 1}`);
	});
});
