import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { postgresSchema } from '../../src/db/schema.postgres.js';
import { sqliteSchema } from '../../src/db/schema.sqlite.js';

interface ColumnLike {
  name: string;
  notNull: boolean;
  primary: boolean;
  hasDefault: boolean;
  dataType: string;
  columnType: string;
  table?: Record<PropertyKey, unknown>;
}

interface IndexLike {
  config: {
    name: string;
    columns: ColumnLike[];
    unique?: boolean;
    where?: unknown;
  };
}

interface ForeignKeyLike {
  onDelete?: string;
  reference(): {
    columns: ColumnLike[];
    foreignColumns: ColumnLike[];
  };
}

interface CheckLike {
  name: string;
}

interface PrimaryKeyLike {
  columns?: ColumnLike[];
  config?: {
    columns?: ColumnLike[];
  };
}

interface TableConfigLike {
  name: string;
  columns: ColumnLike[];
  indexes: IndexLike[];
  foreignKeys: ForeignKeyLike[];
  checks: CheckLike[];
  primaryKeys: PrimaryKeyLike[];
}

interface TableSummary {
  columns: Array<{
    name: string;
    notNull: boolean;
    primary: boolean;
    hasDefault: boolean;
    dataType: string;
  }>;
  indexes: Array<{
    name: string;
    columns: string[];
    unique: boolean;
    partial: boolean;
  }>;
  foreignKeys: Array<{
    columns: string[];
    foreignTable: string;
    foreignColumns: string[];
    onDelete: string | null;
  }>;
  checks: string[];
  primaryKeys: string[][];
}

const expectedTables = [
  'accounts',
  'analytics_salts',
  'artifact_versions',
  'artifacts',
  'bots',
  'magic_link_tokens',
  'sessions',
  'share_viewers',
  'share_visitor_days',
  'shares',
  'stripe_events',
  'templates',
  'view_events',
];

const tableNameSymbol = Symbol.for('drizzle:Name');

describe('schema parity', () => {
  it('walks SQLite and Postgres schemas with identical logical tables, columns, and constraints', () => {
    const sqlite = summarizeSchema(sqliteSchema, getSqliteTableConfig);
    const postgres = summarizeSchema(postgresSchema, getPgTableConfig);

    expect(Object.keys(sqlite).sort()).toEqual(expectedTables);
    expect(Object.keys(postgres).sort()).toEqual(expectedTables);
    expect(postgres).toEqual(sqlite);
  });
});

function summarizeSchema<TTable>(
  schema: Record<string, TTable>,
  getTableConfig: (table: TTable) => unknown
): Record<string, TableSummary> {
  return Object.values(schema).reduce<Record<string, TableSummary>>((summaries, table) => {
    const config = getTableConfig(table) as TableConfigLike;
    summaries[config.name] = summarizeTable(config);
    return summaries;
  }, {});
}

function summarizeTable(config: TableConfigLike): TableSummary {
  return {
    columns: config.columns.map((column) => ({
      name: column.name,
      notNull: column.notNull,
      primary: column.primary,
      hasDefault: column.hasDefault,
      dataType: column.dataType,
    })),
    indexes: config.indexes
      .map((index) => ({
        name: index.config.name,
        columns: index.config.columns.map((column) => column.name),
        unique: index.config.unique === true,
        partial: index.config.where !== undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    foreignKeys: config.foreignKeys
      .map((foreignKey) => {
        const reference = foreignKey.reference();
        return {
          columns: reference.columns.map((column) => column.name),
          foreignTable: tableNameFromColumn(reference.foreignColumns[0]),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          onDelete: foreignKey.onDelete ?? null,
        };
      })
      .sort((left, right) => left.columns.join(',').localeCompare(right.columns.join(','))),
    checks: config.checks.map((check) => check.name).sort(),
    primaryKeys: config.primaryKeys
      .map((primaryKey) =>
        (primaryKey.config?.columns ?? primaryKey.columns ?? []).map((column) => column.name)
      )
      .sort((left, right) => left.join(',').localeCompare(right.join(','))),
  };
}

function tableNameFromColumn(column: ColumnLike | undefined): string {
  const table = column?.table;
  const name = table?.[tableNameSymbol];
  return typeof name === 'string' ? name : 'unknown';
}
