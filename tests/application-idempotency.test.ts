import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let database: typeof import("../server/db")["db"];
let applications: typeof import("../server/applications");
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "alfa-applications-"));
  process.env.DATA_DIR = dataDir;
  ({ db: database } = await import("../server/db"));
  applications = await import("../server/applications");
});

afterAll(() => {
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

beforeEach(() => {
  database.exec(`
    DELETE FROM chat_messages;
    DELETE FROM financial_reports;
    DELETE FROM documents;
    DELETE FROM application_events;
    DELETE FROM more_info_responses;
    DELETE FROM more_info_requests;
    DELETE FROM recommendation_snapshots;
    DELETE FROM external_check_snapshots;
    DELETE FROM applications;
    DELETE FROM calculator_runs;
    DELETE FROM sessions;
    DELETE FROM users;
    DELETE FROM financials;
    DELETE FROM credit_history;
    DELETE FROM products;
    DELETE FROM companies;
  `);
});

function createFixture() {
  const companyId = Number(database.prepare(`
    INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
    VALUES ('Тестовая компания', 'ООО', '7700000001', '1000000000001', '62.01', 'Разработка ПО', '2015-01-01', 'Москва', 'Тест Тестов', 'micro')
  `).run().lastInsertRowid);
  const userId = Number(database.prepare(`
    INSERT INTO users (login, password, name, role, company_id, position)
    VALUES ('idempotent-client', 'test', 'Тест Тестов', 'CLIENT', ?, 'Директор')
  `).run(companyId).lastInsertRowid);
  const sourceFinancialId = Number(database.prepare(`
    INSERT INTO financials (company_id, year, revenue, profit, own_capital, monthly_obligations)
    VALUES (?, 2025, 20000000, 3000000, 5000000, 100000)
  `).run(companyId).lastInsertRowid);
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO financial_reports (
      company_id, source_financial_id, reporting_year, revenue, profit, own_capital,
      monthly_obligations, status, source, submitted_by, verified_by, submitted_at, verified_at, created_at
    ) VALUES (?, ?, 2025, 20000000, 3000000, 5000000, 100000, 'VERIFIED', 'BANK', ?, ?, ?, ?, ?)
  `).run(companyId, sourceFinancialId, userId, userId, timestamp, timestamp, timestamp);
  database.prepare(`
    INSERT INTO credit_history (company_id, bki_score, active_credits, total_debt, overdue_count, worst_delay_days, monthly_payment, updated_at)
    VALUES (?, 780, 1, 500000, 0, 0, 50000, ?)
  `).run(companyId, new Date().toISOString());
  const productId = Number(database.prepare(`
    INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
    VALUES ('idempotent-product', 'Тестовый кредит', 'Тест', 'Тест', 100000, 10000000, 18, 3, 60)
  `).run().lastInsertRowid);
  const calculationId = Number(database.prepare(`
    INSERT INTO calculator_runs (user_id, company_id, product_id, input_json, result_json, created_at)
    VALUES (?, ?, ?, '{}', '{}', ?)
  `).run(userId, companyId, productId, new Date().toISOString()).lastInsertRowid);

  return {
    owner: { id: userId, company_id: companyId, name: "Тест Тестов" },
    input: {
      product_id: productId,
      amount: 1_000_000,
      term_months: 12,
      purpose: "Закупка оборудования",
      purpose_category: "оборудование",
      calculation_id: calculationId,
    },
  };
}

describe("application creation idempotency", () => {
  it("returns the existing application for repeated calculation submissions", () => {
    const fixture = createFixture();

    const first = applications.createApplicationFromCalculation(fixture.owner, fixture.input);
    const repeated = applications.createApplicationFromCalculation(fixture.owner, {
      ...fixture.input,
      purpose: "Повторная попытка с другим текстом",
    });

    expect(first.created).toBe(true);
    expect(repeated).toEqual({ ...first, created: false });
    expect(database.prepare("SELECT COUNT(*) AS count FROM applications").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE to_status = 'SUBMITTED'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT purpose FROM applications WHERE id = ?").get(first.id)).toEqual({ purpose: fixture.input.purpose });
  });

  it("creates exactly one application across a burst of repeated attempts", async () => {
    const fixture = createFixture();

    const results = await Promise.all(Array.from({ length: 8 }, () =>
      Promise.resolve().then(() => applications.createApplicationFromCalculation(fixture.owner, fixture.input)),
    ));

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM applications").get()).toEqual({ count: 1 });
  });

  it("enforces one application per calculation at the database boundary", () => {
    const fixture = createFixture();
    const first = applications.createApplicationFromCalculation(fixture.owner, fixture.input);
    const stored = database.prepare("SELECT * FROM applications WHERE id = ?").get(first.id) as Record<string, unknown>;

    expect(() => database.prepare(`
      INSERT INTO applications (
        public_no, client_id, company_id, product_id, amount, term_months,
        purpose, purpose_category, source_calculation_id, status, created_at, updated_at
      ) VALUES ('DUPLICATE', ?, ?, ?, 1000000, 12, 'Дубликат', 'оборудование', ?, 'SUBMITTED', ?, ?)
    `).run(
      stored.client_id,
      stored.company_id,
      stored.product_id,
      fixture.input.calculation_id,
      new Date().toISOString(),
      new Date().toISOString(),
    )).toThrow();
  });
});
