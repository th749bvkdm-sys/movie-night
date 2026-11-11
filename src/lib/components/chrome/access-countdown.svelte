<script lang="ts">
	import TimerIcon from "@lucide/svelte/icons/timer";
	import { formatRemaining } from "#lib/core/countdown.js";
	import { m } from "#lib/i18n/index.js";
	import { cn } from "#lib/utils.js";
	import { browser } from "$app/env";

	let {
		expiresAt,
		serverNow,
		visible = true,
	}: {
		/** Unix ms, or null when the account has no timer. */
		expiresAt: number | null;
		/** The server's clock when the page loaded, to cancel the device's skew. */
		serverNow: number;
		visible?: boolean;
	} = $props();

	const POLL_MS = 60_000;
	const WARN_MS = 5 * 60_000;

	// The admin can change the timer while this tab is open: the poll below
	// overrides the value the layout loaded.
	let liveExpiresAt = $state<number | null | undefined>(undefined);
	let skew = $state(0);
	let now = $state(Date.now());
	let ended = false;

	const target = $derived(
		liveExpiresAt === undefined ? expiresAt : liveExpiresAt,
	);
	const remaining = $derived(target === null ? null : target - (now + skew));

	$effect(() => {
		skew = serverNow - Date.now();
	});

	function end() {
		if (ended) {
			return;
		}
		ended = true;
		// The server has already signed the account out (or does so on this
		// request): reloading lands on the sign-in page.
		location.reload();
	}

	async function poll() {
		try {
			const response = await fetch("/api/access", { cache: "no-store" });
			if (response.status === 401) {
				end();
				return;
			}
			if (response.ok) {
				const body = (await response.json()) as {
					expiresAt: number | null;
					serverNow: number;
				};
				skew = body.serverNow - Date.now();
				liveExpiresAt = body.expiresAt;
			}
		} catch {
			// Offline: keep counting on the last known value.
		}
	}

	$effect(() => {
		if (!browser) {
			return;
		}
		const tick = setInterval(() => {
			now = Date.now();
		}, 1000);
		const poller = setInterval(poll, POLL_MS);
		return () => {
			clearInterval(tick);
			clearInterval(poller);
		};
	});

	$effect(() => {
		if (remaining !== null && remaining <= 0) {
			end();
		}
	});
</script>

{#if visible && remaining !== null && remaining > 0}
  <div
    class={cn(
      "mb-4 flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs tabular-nums",
      remaining <= WARN_MS
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-foreground/10 bg-background/60 text-muted-foreground",
    )}
    role="timer"
    aria-live="off"
  >
    <TimerIcon class="size-3.5" aria-hidden="true" />
    {m.access_remaining({ time: formatRemaining(remaining) })}
  </div>
{/if}
