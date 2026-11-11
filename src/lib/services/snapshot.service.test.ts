import { describe, expect, it } from "vitest";
import { withoutChannelBinding } from "./snapshot.service.ts";

describe("withoutChannelBinding", () => {
	it("drops channel_binding and keeps sslmode", () => {
		expect(
			withoutChannelBinding(
				"postgresql://u:p@host.neon.tech/db?sslmode=require&channel_binding=require",
			),
		).toBe("postgresql://u:p@host.neon.tech/db?sslmode=require");
	});

	it("leaves an unparseable value alone", () => {
		expect(withoutChannelBinding("not a url")).toBe("not a url");
	});
});
