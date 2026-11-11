import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * The signed-in account's access timer, polled by the countdown so a change
 * made on /admin reaches an open tab without a reload. `hooks.server.ts` has
 * already signed out an expired account by the time this runs, so a 401 here
 * is the client's cue to reload into the sign-in page.
 */
export const GET: RequestHandler = ({ locals }) => {
	const headers = { "cache-control": "no-store" };
	if (!locals.session) {
		return json({ signedIn: false }, { status: 401, headers });
	}
	return json(
		{
			signedIn: true,
			expiresAt: locals.session.accessExpiresAt,
			serverNow: Date.now(),
		},
		{ headers },
	);
};
