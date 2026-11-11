import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SQL } from "bun";
import type { Logger } from "./logger.service.ts";

const TABLE = "movie_night_snapshot";
const ROW_ID = 1;

/**
 * Keeps the instance's SQLite file alive on a host whose disk is wiped on
 * every restart (Render's free tier sleeps after 15 idle minutes). The whole
 * database is copied into one Postgres row: restored before the first
 * connection, saved every `intervalMs` when something changed, and once more
 * on shutdown. Everything else keeps using SQLite exactly as before.
 *
 * The loss window is one interval: a write in the last seconds before a hard
 * kill (not the SIGTERM a sleep sends) is lost.
 */
export class SnapshotService {
	readonly #sql: SQL;
	#lastChanges = -1;
	#timer: ReturnType<typeof setInterval> | null = null;
	#saving: Promise<void> | null = null;

	constructor(
		url: string,
		private readonly logger: Logger,
	) {
		// No named prepared statements: a pooled endpoint (Neon's `-pooler`
		// host is PgBouncer) can hand the next query another server session.
		this.#sql = new SQL({ url, prepare: false, max: 1 });
	}

	async #ensureTable(): Promise<void> {
		await this.#sql.unsafe(
			`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY, data BYTEA NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
		);
	}

	/** Writes the saved copy over `<dir>/nuvio.sqlite`. Call before any connect. */
	async restore(directory: string): Promise<boolean> {
		await this.#ensureTable();
		const rows = (await this
			.#sql`SELECT data FROM movie_night_snapshot WHERE id = ${ROW_ID}`) as {
			data: Uint8Array;
		}[];
		const data = rows[0]?.data;
		if (!data || data.byteLength === 0) {
			this.logger.info("No database snapshot yet: starting empty");
			return false;
		}
		mkdirSync(directory, { recursive: true });
		const file = path.join(directory, "nuvio.sqlite");
		for (const suffix of ["-wal", "-shm"]) {
			if (existsSync(file + suffix)) {
				rmSync(file + suffix);
			}
		}
		writeFileSync(file, data);
		this.logger.info("Database restored from snapshot", {
			bytes: data.byteLength,
		});
		return true;
	}

	/** Saves when the connection has written anything since the last save. */
	save(db: Database, force = false): Promise<void> {
		if (this.#saving !== null) {
			return this.#saving;
		}
		const row = db.query("SELECT total_changes() AS n").get() as { n: number };
		if (!force && row.n === this.#lastChanges) {
			return Promise.resolve();
		}
		const changes = row.n;
		this.#saving = (async () => {
			try {
				const bytes = Buffer.from(db.serialize());
				await this.#sql`
					INSERT INTO movie_night_snapshot (id, data, updated_at)
					VALUES (${ROW_ID}, ${bytes}, now())
					ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
				this.#lastChanges = changes;
			} catch (error) {
				this.logger.error("Database snapshot failed", {
					error: error instanceof Error ? error : "Unknown error",
				});
			} finally {
				this.#saving = null;
			}
		})();
		return this.#saving;
	}

	start(connect: () => Database | null, intervalMs = 15_000): void {
		this.#timer = setInterval(() => {
			const db = connect();
			if (db) {
				void this.save(db);
			}
		}, intervalMs);
	}

	async stop(db: Database | null): Promise<void> {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
		if (db) {
			await this.save(db, true);
		}
		await this.#sql.close();
	}
}
