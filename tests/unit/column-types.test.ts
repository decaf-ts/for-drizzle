import { sqliteTable } from "drizzle-orm/sqlite-core";
import { mysqlTable } from "drizzle-orm/mysql-core";
import { pgTable } from "drizzle-orm/pg-core";
import { buildColumn } from "../../src";
import type { DrizzleColumnType, DrizzleDialect } from "../../src";

interface ColumnOptions {
  primaryKey?: boolean;
  generated?: boolean;
  required?: boolean;
  unique?: boolean;
  indexed?: boolean;
  maxLength?: number;
}

function column(
  dialect: DrizzleDialect,
  type: DrizzleColumnType,
  options: ColumnOptions = {}
): any {
  const builder = buildColumn(dialect, "col", type, {
    primaryKey: false,
    generated: false,
    required: false,
    unique: false,
    ...options,
  });
  const table: any =
    dialect === "sqlite"
      ? sqliteTable("t", { col: builder })
      : dialect === "postgres"
        ? pgTable("t", { col: builder })
        : mysqlTable("t", { col: builder });
  return table.col;
}

describe("buildColumn sqlite physical types", () => {
  it.each([
    ["string", "text", "string"],
    ["number", "integer", "number"],
    ["bigint", "integer", "number"],
    ["boolean", "integer", "boolean"],
    ["date", "integer", "date"],
    ["object", "text", "string"],
  ] as [DrizzleColumnType, string, string][])(
    "maps %s to %s (%s)",
    (type, sqlType, dataType) => {
      const col = column("sqlite", type);
      expect(col.getSQLType()).toBe(sqlType);
      expect(col.dataType).toBe(dataType);
    }
  );

  it("uses a boolean mode for sqlite booleans", () => {
    expect(column("sqlite", "boolean").mode).toBe("boolean");
  });

  it("uses timestamp_ms mode for sqlite dates", () => {
    expect(column("sqlite", "date").mode).toBe("timestamp_ms");
  });
});

describe("buildColumn mysql physical types", () => {
  it.each([
    ["string", "text"],
    ["number", "int"],
    ["bigint", "bigint"],
    ["boolean", "boolean"],
    ["date", "datetime"],
    ["object", "json"],
  ] as [DrizzleColumnType, string][])(
    "maps %s to %s",
    (type, sqlType) => {
      expect(column("mysql", type).getSQLType()).toBe(sqlType);
    }
  );

  it("maps mysql bigint to the bigint data type", () => {
    expect(column("mysql", "bigint").dataType).toBe("bigint");
  });
});

describe("buildColumn postgres physical types", () => {
  it.each([
    ["string", "text"],
    ["number", "integer"],
    ["bigint", "bigint"],
    ["boolean", "boolean"],
    ["date", "timestamp"],
    ["object", "jsonb"],
  ] as [DrizzleColumnType, string][])(
    "maps %s to %s",
    (type, sqlType) => {
      expect(column("postgres", type).getSQLType()).toBe(sqlType);
    }
  );

  it("maps postgres object to the json data type", () => {
    expect(column("postgres", "object").dataType).toBe("json");
  });

  it("maps postgres date to the date data type", () => {
    expect(column("postgres", "date").dataType).toBe("date");
  });
});

describe("buildColumn length handling", () => {
  it("passes sqlite text lengths through", () => {
    expect(column("sqlite", "string", { maxLength: 9 }).getSQLType()).toBe(
      "text(9)"
    );
    expect(column("sqlite", "string", { maxLength: 70000 }).getSQLType()).toBe(
      "text(70000)"
    );
  });

  it("clamps mysql varchar lengths to 65535", () => {
    expect(column("mysql", "string", { maxLength: 9 }).getSQLType()).toBe(
      "varchar(9)"
    );
    expect(column("mysql", "string", { maxLength: 70000 }).getSQLType()).toBe(
      "varchar(65535)"
    );
  });

  it("defaults mysql strings to text so values are not truncated", () => {
    expect(column("mysql", "string").getSQLType()).toBe("text");
  });

  it("keeps mysql key columns bounded to varchar(255)", () => {
    expect(
      column("mysql", "string", { primaryKey: true }).getSQLType()
    ).toBe("varchar(255)");
    expect(column("mysql", "string", { unique: true }).getSQLType()).toBe(
      "varchar(255)"
    );
    expect(column("mysql", "string", { indexed: true }).getSQLType()).toBe(
      "varchar(255)"
    );
  });

  it("passes postgres text lengths through as varchar", () => {
    expect(column("postgres", "string", { maxLength: 9 }).getSQLType()).toBe(
      "varchar(9)"
    );
    expect(
      column("postgres", "string", { maxLength: 70000 }).getSQLType()
    ).toBe("varchar(70000)");
  });

  it("defaults postgres strings to text", () => {
    expect(column("postgres", "string").getSQLType()).toBe("text");
  });

  it("keeps postgres key columns as unbounded text", () => {
    // PostgreSQL can index and key TEXT directly, so key participation does not
    // force a bounded VARCHAR the way MySQL requires.
    expect(
      column("postgres", "string", { primaryKey: true }).getSQLType()
    ).toBe("text");
    expect(column("postgres", "string", { unique: true }).getSQLType()).toBe(
      "text"
    );
    expect(column("postgres", "string", { indexed: true }).getSQLType()).toBe(
      "text"
    );
  });
});

describe("buildColumn constraints", () => {
  it("applies notNull for required columns", () => {
    expect(column("sqlite", "string", { required: true }).notNull).toBe(true);
    expect(column("mysql", "string", { required: true }).notNull).toBe(true);
    expect(column("postgres", "string", { required: true }).notNull).toBe(
      true
    );
  });

  it("does not mark optional columns notNull", () => {
    expect(column("sqlite", "string").notNull).toBe(false);
    expect(column("mysql", "string").notNull).toBe(false);
    expect(column("postgres", "string").notNull).toBe(false);
  });

  it("applies unique constraints", () => {
    expect(column("sqlite", "string", { unique: true }).isUnique).toBe(true);
    expect(column("mysql", "string", { unique: true }).isUnique).toBe(true);
    expect(column("postgres", "string", { unique: true }).isUnique).toBe(
      true
    );
  });

  it("marks primary keys and autoincrements generated numeric ones", () => {
    const sqlitePk = column("sqlite", "number", {
      primaryKey: true,
      generated: true,
      required: true,
    });
    expect(sqlitePk.primary).toBe(true);
    expect(sqlitePk.config.autoIncrement).toBe(true);

    const mysqlPk = column("mysql", "number", {
      primaryKey: true,
      generated: true,
      required: true,
    });
    expect(mysqlPk.primary).toBe(true);
    expect(mysqlPk.config.autoIncrement).toBe(true);
  });

  it("marks postgres primary keys as primary without a builder-level identity", () => {
    // PostgreSQL has no inline AUTO_INCREMENT; identity is emitted by the DDL
    // generator (`GENERATED BY DEFAULT AS IDENTITY`), not the column builder.
    const postgresPk = column("postgres", "number", {
      primaryKey: true,
      generated: true,
      required: true,
    });
    expect(postgresPk.primary).toBe(true);
    expect(postgresPk.notNull).toBe(true);
    expect(postgresPk.config.autoIncrement).toBeFalsy();
  });

  it("does not autoincrement non numeric generated primary keys", () => {
    const sqlitePk = column("sqlite", "string", {
      primaryKey: true,
      generated: true,
      required: true,
    });
    expect(sqlitePk.primary).toBe(true);
    expect(sqlitePk.config.autoIncrement).toBeFalsy();

    const postgresPk = column("postgres", "string", {
      primaryKey: true,
      generated: true,
      required: true,
    });
    expect(postgresPk.primary).toBe(true);
    expect(postgresPk.config.autoIncrement).toBeFalsy();
  });
});
