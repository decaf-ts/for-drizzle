import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { InternalError } from "@decaf-ts/db-decorators";
import { DrizzleMigrator } from "../../src";
import { TestModel } from "../TestModel";
import { createSqliteAdapter } from "../helpers/drizzleSetup";

describe("DrizzleMigrator", () => {
  let handle: Awaited<ReturnType<typeof createSqliteAdapter>>;
  let outDir: string;

  beforeAll(async () => {
    handle = await createSqliteAdapter();
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-migrator-"));
  });

  afterAll(async () => {
    await handle.cleanup();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("requires a migrations folder to run migrations", async () => {
    await expect(
      DrizzleMigrator.migrate((handle.adapter as any).config, "")
    ).rejects.toBeInstanceOf(InternalError);
  });

  it("requires an output folder to generate migrations", async () => {
    await expect(
      DrizzleMigrator.generate((handle.adapter as any).config, [TestModel], "")
    ).rejects.toBeInstanceOf(InternalError);
  });

  it("writes one .sql file per model and returns their paths", async () => {
    const files = await DrizzleMigrator.generate(
      (handle.adapter as any).config,
      [TestModel],
      outDir
    );
    expect(files.length).toBe(1);
    expect(fs.existsSync(files[0])).toBe(true);
    expect(fs.readFileSync(files[0], "utf8")).toContain("tst_user");
  });
});
