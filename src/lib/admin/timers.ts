/** One account's access window, as the admin page lists it. Times are unix ms. */
export interface AccountTimer {
	email: string;
	expiresAt: number;
	setAt: number;
	setBy: string;
}

export const TIMER_UNITS = ["minutes", "hours", "days"] as const;
export type TimerUnit = (typeof TIMER_UNITS)[number];

const UNIT_MS: Record<TimerUnit, number> = {
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
};

/** Converts an amount of a unit to milliseconds. Pure, so it is testable. */
export function durationMs(amount: number, unit: TimerUnit): number {
	return Math.round(amount * UNIT_MS[unit]);
}
