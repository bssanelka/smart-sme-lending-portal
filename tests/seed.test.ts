import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let database: typeof import("../server/db")["db"];
let seedModule: typeof import("../server/seed");
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "alfa-seed-"));
  process.env.DATA_DIR = dataDir;
  ({ db: database } = await import("../server/db"));
  seedModule = await import("../server/seed");
});

afterAll(() => {
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function resetDomainData() {
  database.exec(`
    DELETE FROM chat_messages;
    DELETE FROM financial_reports;
    DELETE FROM documents;
    DELETE FROM more_info_responses;
    DELETE FROM more_info_requests;
    DELETE FROM recommendation_snapshots;
    DELETE FROM external_check_snapshots;
    DELETE FROM application_events;
    DELETE FROM applications;
    DELETE FROM calculator_runs;
    DELETE FROM sessions;
    DELETE FROM users;
    DELETE FROM financials;
    DELETE FROM credit_history;
    DELETE FROM products;
    DELETE FROM news;
    DELETE FROM companies;
    DELETE FROM seed_metadata;
  `);
}

beforeEach(() => resetDomainData());

function count(table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe("versioned synthetic seed", () => {
  it("derives completed reporting periods from the reference year", () => {
    expect(seedModule.demoReportingYears(new Date("2031-01-01T00:00:00.000Z")))
      .toEqual({ latestYear: 2030, previousYear: 2029 });
  });

  it("creates the complete demo dataset atomically and records its version", () => {
    expect(seedModule.seed()).toBe("created");

    expect(count("users")).toBe(4);
    expect(count("companies")).toBe(3);
    expect(count("products")).toBe(4);
    expect(count("financials")).toBe(5);
    expect(count("financial_reports")).toBe(5);
    expect(database.prepare("SELECT COUNT(*) AS count FROM financial_reports WHERE status = 'VERIFIED' AND source = 'DEMO_SEED'").get()).toEqual({ count: 5 });
    const expectedYears = seedModule.demoReportingYears();
    expect(database.prepare("SELECT DISTINCT reporting_year FROM financial_reports ORDER BY reporting_year DESC").all())
      .toEqual([{ reporting_year: expectedYears.latestYear }, { reporting_year: expectedYears.previousYear }]);
    expect(database.prepare("SELECT title FROM news WHERE title LIKE 'Обновлены требования к финансовой отчётности%'").get())
      .toEqual({ title: `Обновлены требования к финансовой отчётности за ${expectedYears.latestYear} год` });
    expect(count("credit_history")).toBe(3);
    expect(count("news")).toBe(6);
    expect(count("applications")).toBe(5);
    expect(database.prepare("SELECT seed_key, version FROM seed_metadata").get()).toEqual({
      seed_key: seedModule.DEMO_SEED_KEY,
      version: seedModule.DEMO_SEED_VERSION,
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  it("does not duplicate an already complete versioned seed", () => {
    expect(seedModule.seed()).toBe("created");
    const before = {
      users: count("users"),
      applications: count("applications"),
      events: count("application_events"),
      checks: count("external_check_snapshots"),
      recommendations: count("recommendation_snapshots"),
    };

    expect(seedModule.seed()).toBe("current");
    expect({
      users: count("users"),
      applications: count("applications"),
      events: count("application_events"),
      checks: count("external_check_snapshots"),
      recommendations: count("recommendation_snapshots"),
    }).toEqual(before);
  });

  it("rolls back all seed data when any insertion fails", () => {
    database.exec(`
      CREATE TRIGGER fail_demo_seed
      BEFORE INSERT ON products
      BEGIN
        SELECT RAISE(ABORT, 'seed failed');
      END;
    `);
    try {
      expect(() => seedModule.seed()).toThrow("seed failed");
      expect(count("companies")).toBe(0);
      expect(count("users")).toBe(0);
      expect(count("products")).toBe(0);
      expect(count("seed_metadata")).toBe(0);
    } finally {
      database.exec("DROP TRIGGER fail_demo_seed");
    }
  });

  it("refuses to repair a partial unversioned seed automatically", () => {
    database.prepare(`
      INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
      VALUES ('Partial', 'ООО', '7700000088', '1000000000088', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест', 'micro')
    `).run();

    expect(() => seedModule.seed()).toThrow("частично заполненная БД");
    expect(count("companies")).toBe(1);
    expect(count("users")).toBe(0);
    expect(count("seed_metadata")).toBe(0);
  });
});
