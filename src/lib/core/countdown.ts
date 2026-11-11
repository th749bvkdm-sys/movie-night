/**
 * Formats milliseconds left as `3d 04:05:06`, or `04:05:06` under a day.
 * Pure, so it is testable; negative input clamps to zero.
 */
export function formatRemaining(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (value: number) => String(value).padStart(2, "0");
	const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	return days > 0 ? `${days}d ${clock}` : clock;
}
