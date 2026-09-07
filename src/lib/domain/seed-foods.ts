import type { Micros, Provenance, SeedFood } from './types';
import { ZERO_MICROS } from './types';

// Every micronutrient the app can show gets a number, so a row that says nothing
// about iron reads as zero iron rather than as undefined arithmetic.
function f(partial: Omit<SeedFood, 'micros'> & { micros?: Partial<Micros> }): SeedFood {
	return { ...partial, micros: { ...ZERO_MICROS, ...partial.micros } };
}

/**
 * The nutrition the sample journal and the recipe book carry with them.
 *
 * Forty-nine rows, and they are exactly the foods `demo-seed.ts` and
 * `recipe-book.ts` name -- the sample journal's entries and every recipe
 * ingredient. Nothing searches this. Since #146 it is not a catalog at all: it
 * has no aliases, no barcodes and no serving weights, because the only things
 * that read it already know which food they want by id. Every food a person can
 * find, scan or type comes from the server catalog (`/api/foods/*`), which is
 * the single path #116 started and this finished.
 *
 * Each row carries a single provenance so the USDA and Open Food Facts licenses
 * never mix inside one entry.
 */
export const SEED_FOODS: SeedFood[] = [
	f({
		id: 'egg-large',
		name: 'Egg, large',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '1 large',
		kcal: 72,
		protein: 6.3,
		carbs: 0.4,
		fat: 4.8,
		micros: {
			sodium: 71,
			potassium: 69,
			iron: 0.88,
			calcium: 28,
			vitaminD: 1.1,
			vitaminB12: 0.56,
			vitaminA: 80,
			folate: 24,
			zinc: 0.65,
			magnesium: 6,
			sugar: 0.2
		}
	}),
	f({
		id: 'chicken-breast',
		name: 'Chicken breast, grilled',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '100 g',
		kcal: 165,
		protein: 31,
		carbs: 0,
		fat: 3.6,
		micros: {
			sodium: 74,
			potassium: 256,
			iron: 0.4,
			zinc: 1,
			vitaminB12: 0.3,
			magnesium: 29,
			vitaminA: 6
		}
	}),
	f({
		id: 'turkey-breast',
		name: 'Turkey breast, roasted',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '100 g',
		kcal: 135,
		protein: 30,
		carbs: 0,
		fat: 1,
		micros: { sodium: 49, potassium: 300, iron: 0.6, zinc: 1.2, vitaminB12: 0.4 }
	}),
	f({
		id: 'ground-turkey',
		name: 'Ground turkey, 93%',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '100 g cooked',
		kcal: 176,
		protein: 27,
		carbs: 0,
		fat: 8,
		micros: { sodium: 80, potassium: 270, iron: 1.5, zinc: 3 }
	}),
	f({
		id: 'salmon',
		name: 'Atlantic salmon, baked',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '100 g',
		kcal: 206,
		protein: 22,
		carbs: 0,
		fat: 12,
		micros: {
			sodium: 59,
			potassium: 363,
			vitaminD: 11,
			vitaminB12: 3.2,
			vitaminA: 12
		}
	}),
	f({
		id: 'tuna-canned',
		name: 'Tuna, canned in water',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '1 can drained (142 g)',
		kcal: 191,
		protein: 42,
		carbs: 0,
		fat: 1.4,
		micros: { sodium: 338, potassium: 333, vitaminD: 2.5, vitaminB12: 2.5 }
	}),
	f({
		id: 'shrimp',
		name: 'Shrimp, cooked',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '100 g',
		kcal: 99,
		protein: 24,
		carbs: 0.2,
		fat: 0.3,
		micros: { sodium: 111, potassium: 259, iron: 0.5, vitaminB12: 1.1, zinc: 1.6 }
	}),
	f({
		id: 'tofu-firm',
		name: 'Tofu, firm',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '100 g',
		kcal: 144,
		protein: 17,
		carbs: 3,
		fat: 9,
		micros: { calcium: 350, iron: 2.7, magnesium: 58, potassium: 237, sodium: 14 }
	}),
	f({
		id: 'tempeh',
		name: 'Tempeh',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '100 g',
		kcal: 192,
		protein: 20,
		carbs: 8,
		fat: 11,
		micros: { iron: 2.7, calcium: 111, magnesium: 81, fiber: 5, potassium: 412 }
	}),
	f({
		id: 'lentils',
		name: 'Lentils, cooked',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 230,
		protein: 18,
		carbs: 40,
		fat: 0.8,
		micros: {
			fiber: 16,
			iron: 6.6,
			folate: 358,
			potassium: 731,
			magnesium: 71,
			sodium: 4
		}
	}),
	f({
		id: 'chickpeas',
		name: 'Chickpeas, cooked',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 269,
		protein: 14.5,
		carbs: 45,
		fat: 4.2,
		micros: { fiber: 12.5, iron: 4.7, folate: 282, potassium: 477, sodium: 11 }
	}),
	f({
		id: 'black-beans',
		name: 'Black beans, cooked',
		category: 'protein',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 227,
		protein: 15,
		carbs: 41,
		fat: 0.9,
		micros: { fiber: 15, iron: 3.6, potassium: 611, folate: 256, magnesium: 120 }
	}),
	f({
		id: 'greek-yogurt',
		name: 'Greek yogurt, plain nonfat',
		category: 'dairy',
		provenance: 'usda',
		servingLabel: '170 g cup',
		kcal: 100,
		protein: 17,
		carbs: 6,
		fat: 0.7,
		micros: {
			calcium: 187,
			potassium: 240,
			sodium: 61,
			vitaminB12: 1.3,
			sugar: 6
		}
	}),
	f({
		id: 'cottage-cheese',
		name: 'Cottage cheese, 1%',
		category: 'dairy',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 163,
		protein: 28,
		carbs: 6,
		fat: 2.3,
		micros: { calcium: 138, sodium: 918, potassium: 220, vitaminB12: 1.4 }
	}),
	f({
		id: 'whey',
		name: 'Whey protein isolate',
		category: 'protein',
		provenance: 'brand',
		servingLabel: '1 scoop (30 g)',
		kcal: 110,
		protein: 25,
		carbs: 2,
		fat: 0.5,
		micros: { sodium: 50, calcium: 120, potassium: 160 }
	}),
	f({
		id: 'chia',
		name: 'Chia seeds',
		category: 'fat',
		provenance: 'usda',
		servingLabel: '1 tbsp',
		kcal: 58,
		protein: 2,
		carbs: 5,
		fat: 3.7,
		micros: { fiber: 4.1, calcium: 75, magnesium: 40, potassium: 49 }
	}),
	f({
		id: 'oats',
		name: 'Oats, dry',
		category: 'grain',
		provenance: 'usda',
		servingLabel: '1/2 cup dry',
		kcal: 154,
		protein: 5.3,
		carbs: 27,
		fat: 2.6,
		micros: { fiber: 4, iron: 1.7, magnesium: 56, potassium: 140, zinc: 1.2 }
	}),
	f({
		id: 'brown-rice',
		name: 'Brown rice, cooked',
		category: 'grain',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 216,
		protein: 5,
		carbs: 45,
		fat: 1.8,
		micros: { fiber: 3.5, magnesium: 84, potassium: 154 }
	}),
	f({
		id: 'quinoa',
		name: 'Quinoa, cooked',
		category: 'grain',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 222,
		protein: 8,
		carbs: 39,
		fat: 3.6,
		micros: { fiber: 5.2, iron: 2.8, magnesium: 118, folate: 78, potassium: 318 }
	}),
	f({
		id: 'pasta',
		name: 'Pasta, cooked',
		category: 'grain',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 220,
		protein: 8,
		carbs: 43,
		fat: 1.3,
		micros: { fiber: 2.5, folate: 126, iron: 1.8 }
	}),
	f({
		id: 'sourdough',
		name: 'Sourdough bread',
		category: 'grain',
		provenance: 'usda',
		servingLabel: '1 slice (40 g)',
		kcal: 105,
		protein: 4,
		carbs: 20,
		fat: 0.6,
		micros: { fiber: 1, sodium: 230, iron: 1.1, folate: 40 }
	}),
	f({
		id: 'wheat-bread',
		name: 'Whole wheat bread',
		category: 'grain',
		provenance: 'usda',
		servingLabel: '1 slice',
		kcal: 81,
		protein: 4,
		carbs: 14,
		fat: 1.1,
		micros: { fiber: 1.9, sodium: 146, iron: 0.8, magnesium: 24 }
	}),
	f({
		id: 'sweet-potato',
		name: 'Sweet potato, baked',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 medium',
		kcal: 103,
		protein: 2.3,
		carbs: 24,
		fat: 0.2,
		micros: {
			fiber: 3.8,
			vitaminA: 1096,
			potassium: 542,
			vitaminC: 22,
			magnesium: 31
		}
	}),
	f({
		id: 'banana',
		name: 'Banana',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 medium',
		kcal: 105,
		protein: 1.3,
		carbs: 27,
		fat: 0.4,
		micros: { fiber: 3.1, potassium: 422, vitaminC: 10, magnesium: 32, sugar: 14 }
	}),
	f({
		id: 'apple',
		name: 'Apple',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 medium',
		kcal: 95,
		protein: 0.5,
		carbs: 25,
		fat: 0.3,
		micros: { fiber: 4.4, potassium: 195, vitaminC: 8.4, sugar: 19 }
	}),
	f({
		id: 'blueberries',
		name: 'Blueberries',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 84,
		protein: 1.1,
		carbs: 21,
		fat: 0.5,
		micros: { fiber: 3.6, vitaminC: 14, potassium: 114, sugar: 15 }
	}),
	f({
		id: 'strawberries',
		name: 'Strawberries',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 cup sliced',
		kcal: 53,
		protein: 1.1,
		carbs: 13,
		fat: 0.5,
		micros: { fiber: 3.3, vitaminC: 98, potassium: 254, folate: 40, sugar: 8 }
	}),
	f({
		id: 'avocado',
		name: 'Avocado',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1/2 fruit',
		kcal: 114,
		protein: 1.3,
		carbs: 6,
		fat: 10.5,
		micros: { fiber: 5, potassium: 345, folate: 60, magnesium: 20, vitaminC: 6 }
	}),
	f({
		id: 'broccoli',
		name: 'Broccoli, steamed',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 55,
		protein: 3.7,
		carbs: 11,
		fat: 0.6,
		micros: {
			fiber: 5.1,
			vitaminC: 101,
			vitaminA: 120,
			potassium: 457,
			folate: 168,
			calcium: 62
		}
	}),
	f({
		id: 'spinach',
		name: 'Spinach, raw',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '2 cups',
		kcal: 14,
		protein: 1.8,
		carbs: 2.2,
		fat: 0.2,
		micros: {
			fiber: 1.3,
			vitaminA: 281,
			vitaminC: 17,
			iron: 1.6,
			folate: 117,
			magnesium: 47,
			potassium: 334
		}
	}),
	f({
		id: 'mixed-greens',
		name: 'Mixed salad greens',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '2 cups',
		kcal: 14,
		protein: 1.2,
		carbs: 2.5,
		fat: 0.2,
		micros: { fiber: 1.2, vitaminA: 200, vitaminC: 12, folate: 50, potassium: 180 }
	}),
	f({
		id: 'tomato',
		name: 'Tomato',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 medium',
		kcal: 22,
		protein: 1.1,
		carbs: 4.8,
		fat: 0.2,
		micros: { vitaminC: 17, potassium: 292, folate: 18, fiber: 1.5 }
	}),
	f({
		id: 'cucumber',
		name: 'Cucumber',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 cup sliced',
		kcal: 16,
		protein: 0.7,
		carbs: 3.6,
		fat: 0.1,
		micros: { potassium: 152, vitaminC: 3 }
	}),
	f({
		id: 'bell-pepper',
		name: 'Bell pepper, red',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 medium',
		kcal: 31,
		protein: 1,
		carbs: 6,
		fat: 0.3,
		micros: { vitaminC: 152, vitaminA: 157, fiber: 2.1, potassium: 211 }
	}),
	f({
		id: 'carrot',
		name: 'Carrots',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 cup chopped',
		kcal: 52,
		protein: 1.2,
		carbs: 12,
		fat: 0.3,
		micros: { fiber: 3.6, vitaminA: 1069, potassium: 410, vitaminC: 7.6 }
	}),
	f({
		id: 'zucchini',
		name: 'Zucchini, cooked',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 27,
		protein: 2,
		carbs: 5,
		fat: 0.4,
		micros: { potassium: 455, vitaminC: 13, fiber: 1.8 }
	}),
	f({
		id: 'asparagus',
		name: 'Asparagus, cooked',
		category: 'produce',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 40,
		protein: 4.3,
		carbs: 7.4,
		fat: 0.4,
		micros: { folate: 134, vitaminA: 90, fiber: 3.6 }
	}),
	f({
		id: 'milk-2',
		name: '2% milk',
		category: 'dairy',
		provenance: 'usda',
		servingLabel: '1 cup',
		kcal: 122,
		protein: 8,
		carbs: 12,
		fat: 5,
		micros: { calcium: 293, vitaminD: 2.9, vitaminB12: 1.3, potassium: 342, sugar: 12 }
	}),
	f({
		id: 'oatly',
		name: 'Oat milk, original',
		brand: 'Oatly',
		category: 'dairy',
		provenance: 'off',
		servingLabel: '1 cup',
		kcal: 120,
		protein: 3,
		carbs: 16,
		fat: 5,
		micros: { calcium: 350, vitaminD: 3.6, sodium: 100, fiber: 2, sugar: 7 }
	}),
	f({
		id: 'feta',
		name: 'Feta cheese',
		category: 'dairy',
		provenance: 'usda',
		servingLabel: '1 oz',
		kcal: 75,
		protein: 4,
		carbs: 1.2,
		fat: 6,
		micros: { calcium: 140, sodium: 316 }
	}),
	f({
		id: 'parmesan',
		name: 'Parmesan, grated',
		category: 'dairy',
		provenance: 'usda',
		servingLabel: '1 tbsp',
		kcal: 21,
		protein: 1.4,
		carbs: 0.2,
		fat: 1.4,
		micros: { calcium: 55, sodium: 76 }
	}),
	f({
		id: 'olive-oil',
		name: 'Olive oil',
		category: 'fat',
		provenance: 'usda',
		servingLabel: '1 tbsp',
		kcal: 119,
		protein: 0,
		carbs: 0,
		fat: 13.5,
		micros: {}
	}),
	f({
		id: 'coffee',
		name: 'Black coffee',
		category: 'drink',
		provenance: 'usda',
		servingLabel: '1 cup (8 oz)',
		kcal: 2,
		protein: 0.3,
		carbs: 0,
		fat: 0,
		micros: { potassium: 116, magnesium: 7 }
	}),
	f({
		id: 'kind-bar',
		name: 'Dark Chocolate Nuts & Sea Salt',
		brand: 'KIND',
		category: 'packaged',
		provenance: 'off',
		servingLabel: '1 bar',
		kcal: 200,
		protein: 6,
		carbs: 16,
		fat: 15,
		micros: { fiber: 7, sodium: 140, potassium: 150, sugar: 5, iron: 1.4 }
	}),
	f({
		id: 'quest-bar',
		name: 'Chocolate Chip Cookie Dough',
		brand: 'Quest',
		category: 'packaged',
		provenance: 'off',
		servingLabel: '1 bar',
		kcal: 200,
		protein: 21,
		carbs: 21,
		fat: 8,
		micros: { fiber: 14, sodium: 220, calcium: 130, sugar: 1 }
	}),
	f({
		id: 'mayo',
		name: 'Mayonnaise',
		category: 'condiment',
		provenance: 'usda',
		servingLabel: '1 tbsp',
		kcal: 94,
		protein: 0.1,
		carbs: 0.1,
		fat: 10,
		micros: { sodium: 88 }
	}),
	f({
		id: 'salsa',
		name: 'Salsa',
		category: 'condiment',
		provenance: 'usda',
		servingLabel: '2 tbsp',
		kcal: 10,
		protein: 0.5,
		carbs: 2,
		fat: 0.1,
		micros: { sodium: 150, vitaminC: 4 }
	}),
	f({
		id: 'egg-mcmuffin',
		name: 'Egg McMuffin',
		brand: "McDonald's",
		category: 'prepared',
		provenance: 'brand',
		servingLabel: '1 sandwich',
		kcal: 310,
		protein: 17,
		carbs: 30,
		fat: 13,
		micros: { sodium: 770, calcium: 230, iron: 2.7, fiber: 2 }
	}),
	f({
		id: 'chipotle-bowl',
		name: 'Chicken burrito bowl',
		brand: 'Chipotle',
		category: 'prepared',
		provenance: 'brand',
		servingLabel: '1 bowl (chicken, rice, beans, salsa, lettuce)',
		kcal: 630,
		protein: 47,
		carbs: 71,
		fat: 16,
		micros: { fiber: 14, sodium: 1540, potassium: 980, iron: 4.2 }
	})
];

export const PROVENANCE_LABEL: Record<Provenance, { title: string; detail: string }> = {
	usda: { title: 'USDA', detail: 'Lab-analyzed · public domain' },
	off: { title: 'Open Food Facts', detail: 'Community · ODbL' },
	lab: { title: 'Lab-analyzed', detail: 'Third-party assay' },
	brand: { title: 'Brand published', detail: 'Manufacturer nutrition' },
	community: { title: 'Community', detail: 'Estimated from similar foods' }
};
