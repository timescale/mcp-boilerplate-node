import { createHash } from 'node:crypto';
import type { FileStore, MigrationSet } from 'migrate';
import migrate from 'migrate';
import { Client } from 'pg';
import { log } from './logger.js';
import type { MigrationsConfig } from './types.js';

interface Store extends FileStore {
  close(): Promise<void>;
}

const createStateStore = (name: string, schema: string = 'public'): Store => {
  let client: Client;

  // Use a hash of the project name to create a lock
  const hash = createHash('sha256').update(name).digest('hex');
  const advisoryLockId = parseInt(hash.substring(0, 15), 16);

  return {
    async load(callback: Parameters<FileStore['load']>[0]): Promise<void> {
      try {
        client = new Client();
        await client.connect();

        // Acquire advisory lock to prevent concurrent migrations
        await client.query(/* sql */ `SELECT pg_advisory_lock($1)`, [
          advisoryLockId,
        ]);

        // Ensure migrations table exists
        await client.query(/* sql */ `
          CREATE SCHEMA IF NOT EXISTS ${schema};

          CREATE TABLE IF NOT EXISTS ${schema}.migrations (
            id SERIAL PRIMARY KEY,
            set JSONB NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Load the most recent migration set
        const result = await client.query(
          /* sql */ `SELECT set FROM ${schema}.migrations ORDER BY applied_at DESC LIMIT 1`,
        );

        const set = result.rows.length > 0 ? result.rows[0].set : {};
        callback(null, set);
      } catch (error) {
        callback(error as Error);
      }
    },

    async save(
      set: MigrationSet,
      callback: (err: Error | null) => void,
    ): Promise<void> {
      try {
        // Insert the entire set as JSONB
        await client.query(
          /* sql */ `INSERT INTO ${schema}.migrations (set) VALUES ($1)`,
          [JSON.stringify(set)],
        );

        callback(null);
      } catch (error) {
        callback(error as Error);
      }
    },

    async close(): Promise<void> {
      if (client) {
        // Release advisory lock
        await client.query(/* sql */ `SELECT pg_advisory_unlock($1)`, [
          advisoryLockId,
        ]);
        await client.end();
      }
    },
  };
};

export const createMigrator = (config: MigrationsConfig) => {
  const { schema, migrationsDirectory, serviceName } = config;
  const stateStore = createStateStore(serviceName, schema);
  return {
    run: async () =>
      new Promise<void>((resolve, reject) => {
        log.info('Running database migrations...');

        // Set search_path via PGOPTIONS so every pg.Client created by migration
        // files picks it up automatically, without touching the migration files.
        const prevPgOptions = process.env.PGOPTIONS;
        if (schema) {
          process.env.PGOPTIONS = `${prevPgOptions ?? ''} --search_path=${schema},public`.trim();
        }

        const restore = () => {
          if (schema) {
            if (prevPgOptions === undefined) {
              delete process.env.PGOPTIONS;
            } else {
              process.env.PGOPTIONS = prevPgOptions;
            }
          }
        };

        migrate.load(
          {
            stateStore,
            migrationsDirectory: migrationsDirectory ?? './migrations',
          },
          (err, set) => {
            if (err) {
              restore();
              log.error('Database migration failed:', err as Error);
              stateStore.close().finally(() => reject(err));
              return;
            }

            set.up((err) => {
              restore();
              stateStore.close().finally(() => {
                if (err) {
                  log.error('Database migration failed:', err as Error);
                  reject(err);
                } else {
                  log.info('Database migrations completed successfully');
                  resolve();
                }
              });
            });
          },
        );
      }),
  };
};
