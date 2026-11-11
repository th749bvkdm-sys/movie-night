import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/env", () => ({ dev: false }));
vi.mock("$app/env/private", () => ({ NUVIO_DATA_DIR: "data" }));

import { formatRemaining } from "#lib/core/countdown.js";
import { DatabaseService } from "#lib/services/database.service.js";
import { canSignIn, setLocked } from "./admin-data.ts";
import { durationMs } from "./timers.ts";
import {
	isTimerExpired,
	listTimers,
	removeTimer,
	setTimer,
	shiftTimer,
	timerExpiry,
} from "./timers-data.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
let db: Database;

beforeEach(() => {
	db = DatabaseService.migrate(new Database(":memory:"));
});

describe("account timers", () => {
	it("converts units", () => {
		expect(durationMs(30, "minutes")).toBe(30 * 60_000);
		expect(durationMs(2, "hours")).toBe(2 * HOUR);
		expect(durationMs(1, "days")).toBe(24 * HOUR);
	});

	it("has no timer by default: unlimited access", () => {
		expect(timerExpiry(db, "a@example.com")).toBeNull();
		expect(isTimerExpired(db, "a@example.com", false, NOW)).toBe(false);
		expect(canSignIn(db, "a@example.com", false)).toBe(true);
	});

	it("expires an account once its time has passed, case-insensitively", () => {
		setTimer(db, "A@Example.com", NOW + HOUR, {
			setBy: "admin@example.com",
			now: NOW,
		});
		expect(isTimerExpired(db, "a@example.com", false, NOW)).toBe(false);
		expect(isTimerExpired(db, "a@example.com", false, NOW + HOUR)).toBe(true);
		expect(listTimers(db)).toEqual([
			{
				email: "a@example.com",
				expiresAt: NOW + HOUR,
				setAt: NOW,
				setBy: "admin@example.com",
			},
		]);
	});

	it("refuses sign-in for an expired account, even on an open instance", () => {
		setTimer(db, "a@example.com", Date.now() - 1000, {
			setBy: "admin@example.com",
		});
		setLocked(db, false);
		expect(canSignIn(db, "a@example.com", false)).toBe(false);
	});

	it("never expires an admin", () => {
		setTimer(db, "boss@example.com", NOW - 1, {
			setBy: "boss@example.com",
			now: NOW,
		});
		expect(isTimerExpired(db, "boss@example.com", true, NOW)).toBe(false);
	});

	it("extends from now when already expired, and shortens from the expiry", () => {
		setTimer(db, "a@example.com", NOW - HOUR, {
			setBy: "admin@example.com",
			now: NOW,
		});
		expect(
			shiftTimer(db, "a@example.com", HOUR, {
				setBy: "admin@example.com",
				now: NOW,
			}),
		).toBe(true);
		expect(timerExpiry(db, "a@example.com")).toBe(NOW + HOUR);
		shiftTimer(db, "a@example.com", -30 * 60_000, {
			setBy: "admin@example.com",
			now: NOW,
		});
		expect(timerExpiry(db, "a@example.com")).toBe(NOW + 30 * 60_000);
	});

	it("reports a missing timer and removes one", () => {
		expect(
			shiftTimer(db, "x@example.com", HOUR, {
				setBy: "admin@example.com",
				now: NOW,
			}),
		).toBe(false);
		setTimer(db, "a@example.com", NOW + HOUR, {
			setBy: "admin@example.com",
			now: NOW,
		});
		removeTimer(db, "A@example.com");
		expect(timerExpiry(db, "a@example.com")).toBeNull();
	});
});

describe("formatRemaining", () => {
	it("formats clocks and days, clamping at zero", () => {
		expect(formatRemaining(65_000)).toBe("00:01:05");
		expect(formatRemaining(26 * HOUR + 1000)).toBe("1d 02:00:01");
		expect(formatRemaining(-5)).toBe("00:00:00");
	});
});
