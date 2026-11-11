<script lang="ts">
	import MinusIcon from "@lucide/svelte/icons/minus";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import TimerIcon from "@lucide/svelte/icons/timer";
	import TrashIcon from "@lucide/svelte/icons/trash-2";
	import IconChip from "#lib/admin/icon-chip.svelte";
	import {
		type AccountTimer,
		TIMER_UNITS,
		type TimerUnit,
	} from "#lib/admin/timers.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Card from "#lib/components/ui/card/index.js";
	import * as Field from "#lib/components/ui/field/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { formatRemaining } from "#lib/core/countdown.js";
	import { getLocale, m } from "#lib/i18n/index.js";
	import { browser } from "$app/env";
	import {
		clearAccountTimer,
		setAccountTimer,
		shiftAccountTimer,
	} from "./admin.remote.ts";

	let { timers, serverNow }: { timers: AccountTimer[]; serverNow: number } =
		$props();

	const unitLabels: Record<TimerUnit, () => string> = {
		minutes: m.admin_timer_unit_minutes,
		hours: m.admin_timer_unit_hours,
		days: m.admin_timer_unit_days,
	};
	const selectClass =
		"h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

	const dateTime = $derived(
		new Intl.DateTimeFormat(getLocale(), {
			dateStyle: "medium",
			timeStyle: "short",
		}),
	);

	let mode = $state<"duration" | "date">("duration");
	let skew = $state(0);
	let now = $state(Date.now());
	const tz = browser ? new Date().getTimezoneOffset() : 0;

	$effect(() => {
		skew = serverNow - Date.now();
	});
	$effect(() => {
		if (!browser) {
			return;
		}
		const tick = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(tick);
	});

	const fields = setAccountTimer.fields;
	const setIssue = $derived(
		fields.email.issues()?.[0]?.message ?? fields.issues()?.[0]?.message,
	);
</script>

<Card.Root class="border border-foreground/10">
  <Card.Header>
    <Card.Title class="flex items-center gap-3"><IconChip icon={TimerIcon} />{m.admin_timers()}</Card.Title>
    <Card.Description>{m.admin_timers_description()}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-6">
    <form {...setAccountTimer} class="flex flex-col gap-4">
      <Field.FieldGroup>
        <Field.Field data-invalid={setIssue ? true : undefined}>
          <Field.FieldLabel for="timer-email">{m.admin_timer_email()}</Field.FieldLabel>
          <Input
            id="timer-email"
            {...fields.email.as("email")}
            autocomplete="off"
            placeholder="person@example.com"
          />
          {#if setIssue}
            <Field.FieldError>{setIssue}</Field.FieldError>
          {/if}
        </Field.Field>
      </Field.FieldGroup>

      <fieldset class="flex flex-wrap gap-x-6 gap-y-2">
        <legend class="mb-2 text-sm font-medium">{m.admin_timer_length()}</legend>
        <label class="flex items-center gap-2 text-sm">
          <input
            {...fields.mode.as("radio", "duration", true)}
            class="accent-primary"
            onchange={() => (mode = "duration")}
          />
          {m.admin_timer_mode_duration()}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input
            {...fields.mode.as("radio", "date")}
            class="accent-primary"
            onchange={() => (mode = "date")}
          />
          {m.admin_timer_mode_date()}
        </label>
      </fieldset>

      <input {...fields.tz.as("hidden", String(tz))} />
      {#if mode === "duration"}
        <div class="flex gap-2">
          <Input
            {...fields.amount.as("number", 1)}
            min="1"
            class="w-28"
            aria-label={m.admin_timer_amount()}
          />
          <select {...fields.unit.as("select")} class={selectClass} aria-label={m.admin_timer_unit()}>
            {#each TIMER_UNITS as unit (unit)}
              <option value={unit} selected={unit === "days"}>{unitLabels[unit]()}</option>
            {/each}
          </select>
        </div>
      {:else}
        <input {...fields.unit.as("hidden", "days")} />
        <Input {...fields.until.as("datetime-local")} class="w-fit" aria-label={m.admin_timer_mode_date()} />
      {/if}

      <div>
        <Button type="submit">{m.admin_timer_start()}</Button>
      </div>
    </form>

    {#if timers.length === 0}
      <p class="text-sm text-muted-foreground">{m.admin_timers_empty()}</p>
    {:else}
      <ul class="flex flex-col divide-y divide-foreground/10">
        {#each timers as timer (timer.email)}
          {@const left = timer.expiresAt - (now + skew)}
          {@const shift = shiftAccountTimer.for(timer.email)}
          {@const clear = clearAccountTimer.for(timer.email)}
          <li class="flex flex-col gap-3 py-3">
            <div class="flex items-center justify-between gap-4">
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate text-sm">{timer.email}</span>
                <span class="text-xs text-muted-foreground">
                  {m.admin_timer_until({ date: dateTime.format(timer.expiresAt) })}
                </span>
              </span>
              <span class="flex items-center gap-2">
                <span
                  class="rounded-full px-2 py-0.5 text-xs tabular-nums {left > 0
                    ? 'bg-primary/10 text-primary'
                    : 'bg-destructive/10 text-destructive'}"
                >
                  {left > 0 ? formatRemaining(left) : m.admin_timer_expired()}
                </span>
                <form {...clear}>
                  <input {...clear.fields.email.as("hidden", timer.email)} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={m.admin_timer_remove_named({ email: timer.email })}
                    title={m.admin_timer_remove()}
                  >
                    <TrashIcon class="size-4" />
                  </Button>
                </form>
              </span>
            </div>
            <form {...shift} class="flex flex-wrap items-center gap-2">
              <input {...shift.fields.email.as("hidden", timer.email)} />
              <Input
                {...shift.fields.amount.as("number", 1)}
                min="1"
                class="h-8 w-20"
                aria-label={m.admin_timer_amount()}
              />
              <select {...shift.fields.unit.as("select")} class="{selectClass} h-8" aria-label={m.admin_timer_unit()}>
                {#each TIMER_UNITS as unit (unit)}
                  <option value={unit} selected={unit === "days"}>{unitLabels[unit]()}</option>
                {/each}
              </select>
              <Button
                size="sm"
                variant="outline"
                {...shift.fields.direction.as("submit", "extend")}
              >
                <PlusIcon class="size-3.5" />{m.admin_timer_extend()}
              </Button>
              <Button
                size="sm"
                variant="outline"
                {...shift.fields.direction.as("submit", "shorten")}
              >
                <MinusIcon class="size-3.5" />{m.admin_timer_shorten()}
              </Button>
              {#if shift.fields.issues()?.[0]}
                <span class="text-xs text-destructive" role="alert">{shift.fields.issues()?.[0]?.message}</span>
              {/if}
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>
