import { invalid } from "@sveltejs/kit";
import * as v from "valibot";
import {
	addToAllowlist,
	removeFromAllowlist,
	setLocked,
} from "#lib/admin/admin-data.js";
import { adminTabSearch } from "#lib/admin/tabs.js";
import { durationMs, TIMER_UNITS } from "#lib/admin/timers.js";
import { removeTimer, setTimer, shiftTimer } from "#lib/admin/timers-data.js";
import { m } from "#lib/i18n/index.js";
import {
	type EmailContent,
	emailHtml,
	emailText,
} from "#lib/notifications/email.js";
import { passwordChange, smtpSettingsSchema } from "#lib/notifications/smtp.js";
import { requireAdmin } from "#lib/server/guards.js";
import { ADMIN_NOTIFICATIONS } from "#lib/services/admin-notifier.service.js";
import { DATABASE, LOGGER } from "#lib/services/index.js";
import { MAILER_SERVICE } from "#lib/services/mailer.service.js";
import { resolve } from "$app/paths";
import { form } from "$app/server";

// Every one of these re-checks `requireAdmin()`. The page guard only protects
// the page: a remote function is its own endpoint and is reachable directly.

export const setInstanceLock = form(
	v.object({ locked: v.picklist(["on", "off"]) }),
	(data) => {
		const { email, event } = requireAdmin();
		const services = event.locals.services;
		const locked = data.locked === "on";
		setLocked(services.get(DATABASE).connect(), locked);
		services
			.get(LOGGER)
			.warn(`Instance ${locked ? "locked" : "unlocked"}`, { by: email });
	},
);

export const allowEmail = form(
	v.object({
		email: v.pipe(
			v.string(),
			v.trim(),
			v.nonEmpty(() => m.admin_error_email_required()),
			v.email(() => m.common_email_invalid()),
		),
	}),
	(data) => {
		const { email, event } = requireAdmin();
		addToAllowlist(
			event.locals.services.get(DATABASE).connect(),
			data.email,
			email,
		);
	},
);

export const revokeEmail = form(
	v.object({ email: v.pipe(v.string(), v.nonEmpty()) }),
	(data) => {
		const { email, event } = requireAdmin();
		if (data.email.trim().toLowerCase() === email.toLowerCase()) {
			invalid(m.admin_error_remove_self());
		}
		removeFromAllowlist(
			event.locals.services.get(DATABASE).connect(),
			data.email,
		);
	},
);

export const saveSmtpSettings = form(smtpSettingsSchema, (data) => {
	const { email, event } = requireAdmin();
	const services = event.locals.services;
	services.get(MAILER_SERVICE).save(
		{
			host: data.host,
			port: data.port,
			security: data.security,
			username: data.username,
			from: data.from,
		},
		passwordChange(data),
	);
	services.get(LOGGER).warn("SMTP settings changed", { by: email });
});

export const sendTestEmail = form(v.object({}), async () => {
	const { email, event } = requireAdmin();
	const content: EmailContent = {
		preview: "Your Nuvio server can send email.",
		heading: "SMTP works",
		paragraphs: [
			"This is a test email from your Nuvio server. Admin notifications will reach you the same way.",
		],
		action: {
			label: "Open the admin page",
			url: `${event.url.origin}${resolve("admin")}${adminTabSearch("notifications")}`,
		},
		footnote: "Sent from the Settings tab of your Nuvio server's admin page.",
	};
	return await event.locals.services.get(MAILER_SERVICE).deliver({
		to: email,
		subject: "Nuvio: test email",
		text: emailText(content),
		html: emailHtml(content),
	});
});

export const markNotificationRead = form(
	v.object({ id: v.pipe(v.string(), v.toNumber(), v.integer()) }),
	(data) => {
		const { email, event } = requireAdmin();
		event.locals.services.get(ADMIN_NOTIFICATIONS).markRead(email, data.id);
	},
);

export const markAllNotificationsRead = form(v.object({}), () => {
	const { email, event } = requireAdmin();
	event.locals.services.get(ADMIN_NOTIFICATIONS).markAllRead(email);
});

export const setNotificationEmail = form(
	v.object({ enabled: v.picklist(["on", "off"]) }),
	(data) => {
		const { email, event } = requireAdmin();
		event.locals.services
			.get(ADMIN_NOTIFICATIONS)
			.setEmailEnabled(email, data.enabled === "on");
	},
);

const timerEmail = v.pipe(
	v.string(),
	v.trim(),
	v.nonEmpty(() => m.admin_error_email_required()),
	v.email(() => m.common_email_invalid()),
);
const timerAmount = v.pipe(
	v.number(() => m.admin_timer_error_amount()),
	v.minValue(1, () => m.admin_timer_error_amount()),
	v.maxValue(100_000, () => m.admin_timer_error_amount()),
);

// A custom date comes from a `datetime-local` input, which has no zone: the
// browser sends its offset alongside so the server (UTC on most hosts) reads
// it as the admin meant it.
function parseLocalDate(value: string, offsetMinutes: number): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		return null;
	}
	const [, year, month, day, hour, minute] = match.map(Number);
	return Date.UTC(year, month - 1, day, hour, minute) + offsetMinutes * 60_000;
}

/** Starts (or replaces) an account's timer: a duration from now, or a date. */
export const setAccountTimer = form(
	v.object({
		email: timerEmail,
		mode: v.picklist(["duration", "date"]),
		amount: v.optional(v.number()),
		unit: v.picklist(TIMER_UNITS),
		until: v.optional(v.string(), ""),
		tz: v.optional(v.string(), "0"),
	}),
	(data) => {
		const { email, event } = requireAdmin();
		const now = Date.now();
		let expiresAt: number;
		if (data.mode === "date") {
			const parsed = parseLocalDate(data.until, Number(data.tz) || 0);
			if (parsed === null || parsed <= now) {
				invalid(m.admin_timer_error_date());
			}
			expiresAt = parsed;
		} else {
			const amount = v.safeParse(timerAmount, data.amount);
			if (!amount.success) {
				invalid(m.admin_timer_error_amount());
			}
			expiresAt = now + durationMs(amount.output, data.unit);
		}
		setTimer(
			event.locals.services.get(DATABASE).connect(),
			data.email,
			expiresAt,
			{ setBy: email, now },
		);
		event.locals.services
			.get(LOGGER)
			.info("Account timer set", { account: data.email, by: email });
	},
);

/** Extends or shortens an existing timer by a duration. */
export const shiftAccountTimer = form(
	v.object({
		email: v.pipe(v.string(), v.nonEmpty()),
		direction: v.picklist(["extend", "shorten"]),
		amount: timerAmount,
		unit: v.picklist(TIMER_UNITS),
	}),
	(data) => {
		const { email, event } = requireAdmin();
		const delta = durationMs(data.amount, data.unit);
		const moved = shiftTimer(
			event.locals.services.get(DATABASE).connect(),
			data.email,
			data.direction === "extend" ? delta : -delta,
			{ setBy: email },
		);
		if (!moved) {
			invalid(m.admin_timer_error_missing());
		}
	},
);

/** Removes the timer: the account's access becomes unlimited again. */
export const clearAccountTimer = form(
	v.object({ email: v.pipe(v.string(), v.nonEmpty()) }),
	(data) => {
		const { event } = requireAdmin();
		removeTimer(event.locals.services.get(DATABASE).connect(), data.email);
	},
);
