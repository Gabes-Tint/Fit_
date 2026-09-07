import type { Routine } from '$lib/domain/types';
import { routineLetter, routineTone, type RoutineTone } from './routine-tone';

/** A routine dressed for the planner, so it keeps one letter and one color on every screen. */
export type PlanOption = {
	id: string;
	name: string;
	letter: string;
	tone: RoutineTone;
};

/** The rotation, in order. There is no option for rest: a day with nothing on it is rest. */
export function planOptions(routines: Routine[]): PlanOption[] {
	return routines.map((routine, index) => ({
		id: routine.id,
		name: routine.name,
		letter: routineLetter(routine.name),
		tone: routineTone(index)
	}));
}

/** The options a day holds, in the order the day holds them. */
export function optionsOn(options: PlanOption[], routineIds: string[]): PlanOption[] {
	return routineIds.flatMap((id) => options.filter((option) => option.id === id));
}
