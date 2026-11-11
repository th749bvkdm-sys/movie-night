import type { Database } from "bun:sqlite";
import { normalizeEmail } from "./admin-data.ts";
import type { AccountTimer } from "./timers.ts";

interface TimerRow {
	email: string;
	expires_at: number;
	set_at: number;
	set_by: string;
}

function toTimer(row: TimerRow): AccountTimer {
	return {
		email: row.email,
		expiresAt: row.expires_at,
		setAt: row.set_at,
		setBy: row.set_by,
	};
}

export function listTimers(db: Database): AccountTimer[] {
	return db
		.query(
			"SELECT email, expires_at, set_at, set_by FROM account_timers ORDER BY expires_at",
		)
		.all()
		.map((row) => toTimer(row as TimerRow));
}

/** The account's expiry, or null when it has no timer (unlimited). */
export function timerExpiry(db: Database, email: string): number | null {
	const row = db
		.query("SELECT expires_at FROM account_timers WHERE email = ?")
		.get(normalizeEmail(email)) as { expires_at: number } | null;
	return row?.expires_at ?? null;
}

/**
 * Whether the account's timer has run out. Admins never expire, so a timer
 * set on the host's own address can't lock them out of the page that edits it.
 */
export function isTimerExpired(
	db: Database,
	email: string,
	isAdmin: boolean,
	now = Date.now(),
): boolean {
	if (isAdmin) {
		return false;
	}
	const expiresAt = timerExpiry(db, email);
	return expiresAt !== null && expiresAt <= now;
}

/** Who changed a timer, and when (defaults to now). */
export interface TimerChange {
	setBy: string;
	now?: number;
}

export function setTimer(
	db: Database,
	email: string,
	expiresAt: number,
	{ setBy, now = Date.now() }: TimerChange,
): void {
	db.query(
		`INSERT INTO account_timers (email, expires_at, set_at, set_by)
		 VALUES ($email, $expiresAt, $now, $setBy)
		 ON CONFLICT(email) DO UPDATE SET expires_at = $expiresAt, set_at = $now, set_by = $setBy`,
	).run({
		$email: normalizeEmail(email),
		$expiresAt: expiresAt,
		$now: now,
		$setBy: normalizeEmail(setBy),
	});
}

/**
 * Moves an existing timer by `deltaMs` (negative shortens). An expired timer
 * is extended from now, not from the past expiry, so "+1 day" always means a
 * day of access. Returns false when the account has no timer.
 */
export function shiftTimer(
	db: Database,
	email: string,
	deltaMs: number,
	{ setBy, now = Date.now() }: TimerChange,
): boolean {
	const current = timerExpiry(db, email);
	if (current === null) {
		return false;
	}
	const base = deltaMs > 0 ? Math.max(current, now) : current;
	setTimer(db, email, base + deltaMs, { setBy, now });
	return true;
}

export function removeTimer(db: Database, email: string): void {
	db.query("DELETE FROM account_timers WHERE email = ?").run(
		normalizeEmail(email),
	);
}
