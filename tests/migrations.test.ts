import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildDecisionEconomics } from "../server/calculator";
import { buildDocumentPackage, documentContentHash } from "../server/document-templates";
import { LATEST_SCHEMA_VERSION, SCHEMA_MIGRATIONS, runMigrations, type SchemaMigration } from "../server/migrations";

function memoryDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  return database;
}

describe("versioned schema migrations", () => {
  it("creates the latest schema on a fresh database and is repeatable", () => {
    const database = memoryDatabase();
    try {
      expect(LATEST_SCHEMA_VERSION).toBe(12);
      expect(runMigrations(database)).toBe(SCHEMA_MIGRATIONS.length);
      expect(database.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
      expect(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: SCHEMA_MIGRATIONS.length });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recommendation_snapshots'").get()).toEqual({ name: "recommendation_snapshots" });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'seed_metadata'").get()).toEqual({ name: "seed_metadata" });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'more_info_requests'").get()).toEqual({ name: "more_info_requests" });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'more_info_responses'").get()).toEqual({ name: "more_info_responses" });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'financial_reports'").get()).toEqual({ name: "financial_reports" });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'idempotency_records'").get()).toEqual({ name: "idempotency_records" });
      const documentColumns = database.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
      expect(documentColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["document_version", "content_hash", "content_text", "opened_at", "acknowledged_at", "signed_at"]));
      const applicationColumns = database.prepare("PRAGMA table_info(applications)").all() as Array<{ name: string }>;
      expect(applicationColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["signed_at", "signed_by", "issued_at", "issued_by", "issuance_mode"]));
      expect(runMigrations(database)).toBe(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: SCHEMA_MIGRATIONS.length });
    } finally {
      database.close();
    }
  });

  it("upgrades a version-one database without losing existing rows", () => {
    const database = memoryDatabase();
    try {
      expect(runMigrations(database, [SCHEMA_MIGRATIONS[0]])).toBe(1);
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Legacy', 'ООО', '7700000099', '1000000000099', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест', 'micro')
      `).run().lastInsertRowid);
      const userId = Number(database.prepare(`
        INSERT INTO users (login, password, name, role, company_id, position)
        VALUES ('legacy', 'test', 'Legacy', 'CLIENT', ?, 'Директор')
      `).run(companyId).lastInsertRowid);
      const productId = Number(database.prepare(`
        INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
        VALUES ('legacy', 'Legacy', 'Legacy', 'Legacy', 1, 1000, 20, 1, 12)
      `).run().lastInsertRowid);
      database.prepare(`
        INSERT INTO applications (public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category, status, created_at, updated_at)
        VALUES ('LEGACY-1', ?, ?, ?, 100, 6, 'Legacy', 'оборотные средства', 'SUBMITTED', '2025-01-01', '2025-01-01')
      `).run(userId, companyId, productId);

      expect(runMigrations(database)).toBe(SCHEMA_MIGRATIONS.length - 1);
      const columns = database.prepare("PRAGMA table_info(applications)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("source_calculation_id");
      expect(columns.map((column) => column.name)).toContain("scorecard_version");
      expect(database.prepare("SELECT public_no FROM applications").get()).toEqual({ public_no: "LEGACY-1" });
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("adds only missing economics to legacy snapshots", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 5));
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Legacy offer', 'ООО', '7700000088', '1000000000088', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест', 'micro')
      `).run().lastInsertRowid);
      const userId = Number(database.prepare(`
        INSERT INTO users (login, password, name, role, company_id, position)
        VALUES ('legacy-offer', 'test', 'Legacy', 'CLIENT', ?, 'Директор')
      `).run(companyId).lastInsertRowid);
      const productId = Number(database.prepare(`
        INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
        VALUES ('legacy-offer', 'Legacy', 'Legacy', 'Legacy', 1, 1000000, 12, 1, 24)
      `).run().lastInsertRowid);
      const calculationId = Number(database.prepare(`
        INSERT INTO calculator_runs (user_id, company_id, product_id, input_json, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, '2026-10-20T00:00:00.000Z')
      `).run(
        userId,
        companyId,
        productId,
        JSON.stringify({ product_id: productId, amount: 100_000, term_months: 12, purpose_category: "оборотные средства" }),
        JSON.stringify({ result: { current: { rate: 12, monthlyPayment: 8_884.88, overpayment: 6_618.56 } } }),
      ).lastInsertRowid);
      const originalDecision = {
        type: "APPROVE",
        productId,
        productName: "Legacy",
        amount: 100_000,
        rate: 12,
        termMonths: 12,
        reason: "Решение аналитика сохраняется",
        decidedAt: "2026-10-20T00:00:00.000Z",
        preliminaryTerms: { amount: 100_000, overpayment: 6_618.56 },
        customLegacyField: "keep-me",
      };
      database.prepare(`
        INSERT INTO applications (
          public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category,
          source_calculation_id, status, decision, decided_at, created_at, updated_at
        ) VALUES ('LEGACY-OFFER-1', ?, ?, ?, 100000, 12, 'Legacy', 'оборотные средства', ?, 'OFFER', ?,
          '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z')
      `).run(userId, companyId, productId, calculationId, JSON.stringify(originalDecision));

      expect(runMigrations(database)).toBe(7);
      const application = database.prepare("SELECT status, decision, updated_at FROM applications WHERE public_no = 'LEGACY-OFFER-1'").get() as {
        status: string; decision: string; updated_at: string;
      };
      const decision = JSON.parse(application.decision) as Record<string, unknown>;
      const calculation = database.prepare("SELECT result_json FROM calculator_runs WHERE id = ?").get(calculationId) as { result_json: string };
      const result = JSON.parse(calculation.result_json) as { result: { current: Record<string, unknown> } };

      expect(application.status).toBe("OFFER");
      expect(application.updated_at).toBe("2026-10-20T00:00:00.000Z");
      expect(decision).toMatchObject({
        reason: "Банк одобрил заявку на предложенных условиях после проверки предоставленных данных.",
        clientComment: "Банк одобрил заявку на предложенных условиях после проверки предоставленных данных.",
        internalReason: originalDecision.reason,
        customLegacyField: "keep-me",
        monthlyPayment: 8_884.88,
        overpayment: 6_618.56,
        totalPayment: 106_618.56,
        paymentType: "ANNUITY",
        feesIncluded: false,
        validUntil: "2026-10-27T00:00:00.000Z",
        preliminaryTerms: { amount: 100_000, overpayment: 6_618.56, totalPayment: 106_618.56 },
      });
      expect(result.result.current.totalPayment).toBe(106_618.56);
    } finally {
      database.close();
    }
  });

  it("moves a legacy MORE_INFO decision into a typed request without changing status", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 6));
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Legacy info', 'ООО', '7700000077', '1000000000077', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест', 'micro')
      `).run().lastInsertRowid);
      const clientId = Number(database.prepare(`INSERT INTO users (login, password, name, role, company_id) VALUES ('legacy-info', 'test', 'Client', 'CLIENT', ?)`)
        .run(companyId).lastInsertRowid);
      const bankId = Number(database.prepare(`INSERT INTO users (login, password, name, role, company_id) VALUES ('legacy-bank', 'test', 'Bank', 'BANK', NULL)`)
        .run().lastInsertRowid);
      const productId = Number(database.prepare(`
        INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
        VALUES ('legacy-info', 'Legacy', 'Legacy', 'Legacy', 1, 1000000, 12, 1, 24)
      `).run().lastInsertRowid);
      const decision = JSON.stringify({ type: "MORE_INFO", rate: null, amount: null, termMonths: null, reason: "Требуется финансовая отчётность", decidedAt: "2026-10-20T00:00:00.000Z" });
      const applicationId = Number(database.prepare(`
        INSERT INTO applications (public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category, status, decision, decided_by, decided_at, created_at, updated_at)
        VALUES ('LEGACY-INFO-1', ?, ?, ?, 100000, 12, 'Legacy', 'оборотные средства', 'MORE_INFO', ?, ?, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z')
      `).run(clientId, companyId, productId, decision, bankId).lastInsertRowid);
      const recommendationId = Number(database.prepare(`
        INSERT INTO recommendation_snapshots (application_id, scorecard_version, score, grade, factors_json, proposal_json, calculated_at)
        VALUES (?, 'rule-based-v1', 70, 'B', '[]', '{}', '2026-10-19T00:00:00.000Z')
      `).run(applicationId).lastInsertRowid);

      expect(runMigrations(database)).toBe(6);
      expect(database.prepare("SELECT status, decision, decided_by, decided_at, updated_at FROM applications WHERE id = ?").get(applicationId)).toEqual({
        status: "MORE_INFO",
        decision: null,
        decided_by: null,
        decided_at: null,
        updated_at: "2026-10-20T00:00:00.000Z",
      });
      const request = database.prepare("SELECT id, request_type, reason, required_fields_json, status, source, requested_by FROM more_info_requests WHERE application_id = ?").get(applicationId) as Record<string, unknown>;
      expect(request).toMatchObject({
        request_type: "FINANCIALS",
        reason: "Требуется финансовая отчётность",
        status: "WAITING_CLIENT",
        source: "BANK",
        requested_by: bankId,
      });
      expect(JSON.parse(request.required_fields_json as string)).toEqual(["year", "revenue", "profit", "own_capital", "monthly_obligations"]);
      expect(database.prepare("SELECT superseded_at, superseded_by_request_id FROM recommendation_snapshots WHERE id = ?").get(recommendationId)).toEqual({
        superseded_at: "2026-10-20T00:00:00.000Z",
        superseded_by_request_id: request.id,
      });
    } finally {
      database.close();
    }
  });

  it("copies legacy financials into provenance records without changing source rows", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 7));
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Legacy finance', 'ООО', '7700000066', '1000000000066', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест', 'micro')
      `).run().lastInsertRowid);
      const firstId = Number(database.prepare(`
        INSERT INTO financials (company_id, year, revenue, profit, own_capital, monthly_obligations)
        VALUES (?, 2025, 10000000, 1000000, 3000000, 100000)
      `).run(companyId).lastInsertRowid);
      const latestId = Number(database.prepare(`
        INSERT INTO financials (company_id, year, revenue, profit, own_capital, monthly_obligations)
        VALUES (?, 2025, 12000000, 1500000, 3500000, 90000)
      `).run(companyId).lastInsertRowid);
      const invalidId = Number(database.prepare(`
        INSERT INTO financials (company_id, year, revenue, profit, own_capital, monthly_obligations)
        VALUES (?, 2026, 1000000, 9000000, 3500000, 90000)
      `).run(companyId).lastInsertRowid);

      expect(runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 8))).toBe(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM financials WHERE company_id = ?").get(companyId)).toEqual({ count: 3 });
      expect(database.prepare("SELECT source_financial_id, status, source, revenue FROM financial_reports WHERE source_financial_id = ?").get(firstId))
        .toEqual({ source_financial_id: firstId, status: "REJECTED", source: "LEGACY", revenue: 10_000_000 });
      expect(database.prepare("SELECT source_financial_id, status, source, revenue, submitted_by, verified_by FROM financial_reports WHERE source_financial_id = ?").get(latestId))
        .toEqual({ source_financial_id: latestId, status: "SUBMITTED", source: "LEGACY", revenue: 12_000_000, submitted_by: null, verified_by: null });
      expect(database.prepare("SELECT status, source, rejection_reason FROM financial_reports WHERE source_financial_id = ?").get(invalidId))
        .toEqual({ status: "REJECTED", source: "LEGACY", rejection_reason: "Legacy-данные не прошли доменную проверку и сохранены только для аудита" });
      const recommendationColumns = database.prepare("PRAGMA table_info(recommendation_snapshots)").all() as Array<{ name: string }>;
      expect(recommendationColumns.map((column) => column.name)).toContain("financial_report_snapshot_json");
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("backfills distinct versioned content for legacy document packages", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 8));
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Legacy docs', 'ООО', '7700000055', '1000000000055', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест Тестов', 'micro')
      `).run().lastInsertRowid);
      const clientId = Number(database.prepare(`INSERT INTO users (login, password, name, role, company_id) VALUES ('legacy-docs', 'test', 'Client', 'CLIENT', ?)`)
        .run(companyId).lastInsertRowid);
      const productId = Number(database.prepare(`
        INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
        VALUES ('legacy-docs', 'Оборотный кредит', 'Legacy', 'Legacy', 1, 1000000, 20, 1, 24)
      `).run().lastInsertRowid);
      const decidedAt = "2026-10-20T00:00:00.000Z";
      const decision = JSON.stringify({
        type: "APPROVE", productId, productName: "Оборотный кредит", amount: 100_000, rate: 20,
        termMonths: 12, reason: "Одобрено", decidedAt, ...buildDecisionEconomics(100_000, 20, 12, decidedAt),
      });
      const applicationId = Number(database.prepare(`
        INSERT INTO applications (public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category, status, decision, decided_at, created_at, updated_at)
        VALUES ('LEGACY-DOCS-1', ?, ?, ?, 100000, 12, 'Закупка', 'оборотные средства', 'SIGNING', ?, ?, ?, ?)
      `).run(clientId, companyId, productId, decision, decidedAt, decidedAt, decidedAt).lastInsertRowid);
      const insertDocument = database.prepare("INSERT INTO documents (application_id, kind, filename, status, created_at) VALUES (?, ?, ?, 'GENERATED', ?)");
      for (const kind of ["Кредитный договор", "График платежей", "Справка о состоянии счёта"]) {
        insertDocument.run(applicationId, kind, `${kind}.txt`, decidedAt);
      }

      expect(runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 9))).toBe(1);
      const documents = database.prepare(`
        SELECT kind, status, document_version, content_hash, content_text, opened_at, acknowledged_at
        FROM documents WHERE application_id = ? ORDER BY id
      `).all(applicationId) as Array<Record<string, unknown>>;
      expect(documents).toHaveLength(3);
      expect(new Set(documents.map((document) => document.content_hash)).size).toBe(3);
      expect(documents.every((document) => document.status === "GENERATED" && document.document_version === "credit-docs-v2")).toBe(true);
      expect(documents.every((document) => typeof document.content_text === "string" && (document.content_text as string).length > 100)).toBe(true);
      expect(documents.every((document) => document.opened_at === null && document.acknowledged_at === null)).toBe(true);
      expect(database.prepare("SELECT status, updated_at FROM applications WHERE id = ?").get(applicationId))
        .toEqual({ status: "SIGNING", updated_at: decidedAt });
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("backfills legacy issued metadata without rewriting status or events", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 9));
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Legacy issued', 'ООО', '7700000044', '1000000000044', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест Тестов', 'micro')
      `).run().lastInsertRowid);
      const clientId = Number(database.prepare(`INSERT INTO users (login, password, name, role, company_id) VALUES ('legacy-issued', 'test', 'Client', 'CLIENT', ?)`)
        .run(companyId).lastInsertRowid);
      const productId = Number(database.prepare(`
        INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
        VALUES ('legacy-issued', 'Legacy', 'Legacy', 'Legacy', 1, 1000000, 20, 1, 24)
      `).run().lastInsertRowid);
      const createdAt = "2026-10-19T00:00:00.000Z";
      const issuedAt = "2026-10-20T00:00:00.000Z";
      const decision = JSON.stringify({ type: "APPROVE", reason: "Историческое решение" });
      const applicationId = Number(database.prepare(`
        INSERT INTO applications (public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category, status, decision, created_at, updated_at)
        VALUES ('LEGACY-ISSUED-1', ?, ?, ?, 100000, 12, 'Закупка', 'оборотные средства', 'ISSUED', ?, ?, ?)
      `).run(clientId, companyId, productId, decision, createdAt, issuedAt).lastInsertRowid);
      database.prepare(`
        INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at)
        VALUES (?, 'SIGNING', 'ISSUED', 'Клиент', 'Legacy combined event', ?)
      `).run(applicationId, issuedAt);
      const eventsBefore = database.prepare("SELECT id, from_status, to_status, actor, comment, created_at FROM application_events WHERE application_id = ? ORDER BY id").all(applicationId);

      expect(runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 10))).toBe(1);
      expect(database.prepare(`
        SELECT status, decision, updated_at, signed_at, signed_by, issued_at, issued_by, issuance_mode
        FROM applications WHERE id = ?
      `).get(applicationId)).toEqual({
        status: "ISSUED",
        decision,
        updated_at: issuedAt,
        signed_at: issuedAt,
        signed_by: clientId,
        issued_at: issuedAt,
        issued_by: null,
        issuance_mode: "LEGACY_COMBINED",
      });
      expect(database.prepare("SELECT id, from_status, to_status, actor, comment, created_at FROM application_events WHERE application_id = ? ORDER BY id").all(applicationId)).toEqual(eventsBefore);
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("adds command idempotency without rewriting applications, events or documents", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 10));
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Migration 11', 'ООО', '7700000055', '1000000000055', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест Тестов', 'micro')
      `).run().lastInsertRowid);
      const clientId = Number(database.prepare("INSERT INTO users (login, password, name, role, company_id) VALUES ('migration-11-client', 'test', 'Client', 'CLIENT', ?)")
        .run(companyId).lastInsertRowid);
      const productId = Number(database.prepare(`
        INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
        VALUES ('migration-11', 'Migration product', 'Test', 'Test', 1, 1000000, 20, 1, 24)
      `).run().lastInsertRowid);
      const createdAt = "2026-10-23T00:00:00.000Z";
      const applicationId = Number(database.prepare(`
        INSERT INTO applications (public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category, status, created_at, updated_at)
        VALUES ('MIGRATION-11-1', ?, ?, ?, 100000, 12, 'Закупка', 'оборотные средства', 'SIGNING', ?, ?)
      `).run(clientId, companyId, productId, createdAt, createdAt).lastInsertRowid);
      database.prepare(`
        INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at)
        VALUES (?, 'DOCUMENTS', 'SIGNING', 'Client', 'Test event', ?)
      `).run(applicationId, createdAt);
      database.prepare(`
        INSERT INTO documents (application_id, kind, filename, status, created_at)
        VALUES (?, 'offer', 'offer.txt', 'GENERATED', ?)
      `).run(applicationId, createdAt);

      const applicationBefore = database.prepare("SELECT * FROM applications WHERE id = ?").get(applicationId);
      const eventsBefore = database.prepare("SELECT * FROM application_events WHERE application_id = ? ORDER BY id").all(applicationId);
      const documentsBefore = database.prepare("SELECT * FROM documents WHERE application_id = ? ORDER BY id").all(applicationId);

      expect(runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 11))).toBe(1);
      expect(database.pragma("user_version", { simple: true })).toBe(11);
      expect(database.prepare("SELECT * FROM applications WHERE id = ?").get(applicationId)).toEqual(applicationBefore);
      expect(database.prepare("SELECT * FROM application_events WHERE application_id = ? ORDER BY id").all(applicationId)).toEqual(eventsBefore);
      expect(database.prepare("SELECT * FROM documents WHERE application_id = ? ORDER BY id").all(applicationId)).toEqual(documentsBefore);

      const insertRecord = database.prepare(`
        INSERT INTO idempotency_records (user_id, idempotency_key, operation, request_hash, response_json, created_at)
        VALUES (?, 'migration-key', 'test', 'hash', '{}', ?)
      `);
      insertRecord.run(clientId, createdAt);
      expect(() => insertRecord.run(clientId, createdAt)).toThrow();
      expect(() => insertRecord.run(999999, createdAt)).toThrow();
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("separates legacy decision text without rewriting audit history or signed snapshots", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 11));
      const companyId = Number(database.prepare(`
        INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
        VALUES ('Migration 12', 'ООО', '7700000033', '1000000000033', '62.01', 'ПО', '2010-01-01', 'Москва', 'Тест Тестов', 'micro')
      `).run().lastInsertRowid);
      const clientId = Number(database.prepare("INSERT INTO users (login, password, name, role, company_id) VALUES ('migration-12-client', 'test', 'Client', 'CLIENT', ?)")
        .run(companyId).lastInsertRowid);
      const productId = Number(database.prepare(`
        INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max)
        VALUES ('migration-12', 'Migration product', 'Test', 'Test', 1, 1000000, 20, 1, 24)
      `).run().lastInsertRowid);
      const decidedAt = "2026-10-23T00:00:00.000Z";
      const internalReason = "Внутренняя scoring-рекомендация только для аналитика";
      const economics = {
        amount: 100_000,
        rate: 20,
        termMonths: 12,
        ...buildDecisionEconomics(100_000, 20, 12, decidedAt),
      };
      const legacyDecision = {
        type: "CONDITIONS",
        productId,
        productName: "Migration product",
        reason: internalReason,
        decidedAt,
        ...economics,
      };
      const applicationId = Number(database.prepare(`
        INSERT INTO applications (
          public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category,
          status, decision, decided_at, signed_at, signed_by, created_at, updated_at
        ) VALUES ('MIGRATION-12-1', ?, ?, ?, 100000, 12, 'Закупка', 'оборотные средства',
          'READY_FOR_ISSUANCE', ?, ?, ?, ?, ?, ?)
      `).run(clientId, companyId, productId, JSON.stringify(legacyDecision), decidedAt, decidedAt, clientId, decidedAt, decidedAt).lastInsertRowid);
      database.prepare(`
        INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at)
        VALUES (?, 'DECISION', 'OFFER', 'Bank', ?, ?)
      `).run(applicationId, internalReason, decidedAt);
      const legacyDocuments = buildDocumentPackage({
        publicNo: "MIGRATION-12-1",
        companyName: "Migration 12",
        companyInn: "7700000033",
        companyHeadName: "Тест Тестов",
        productName: "Migration product",
        purpose: "Закупка",
        decisionReason: internalReason,
        decidedAt,
        generatedAt: decidedAt,
        economics,
      });
      const insertDocument = database.prepare(`
        INSERT INTO documents (
          application_id, kind, filename, status, document_version, content_hash, content_text,
          opened_at, opened_by, acknowledged_at, acknowledged_by, signed_at, signed_by, created_at
        ) VALUES (?, ?, ?, 'SIGNED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const document of legacyDocuments) {
        insertDocument.run(
          applicationId, document.kind, document.filename, document.version, document.contentHash, document.content,
          decidedAt, clientId, decidedAt, clientId, decidedAt, clientId, decidedAt,
        );
      }

      expect(runMigrations(database)).toBe(1);
      expect(database.pragma("user_version", { simple: true })).toBe(12);
      const stored = database.prepare("SELECT status, decision, signed_at, signed_by FROM applications WHERE id = ?").get(applicationId) as {
        status: string; decision: string; signed_at: string | null; signed_by: number | null;
      };
      expect(stored).toMatchObject({ status: "SIGNING", signed_at: null, signed_by: null });
      expect(JSON.parse(stored.decision)).toMatchObject({
        reason: "Банк предлагает скорректированные условия после проверки предоставленных данных.",
        clientComment: "Банк предлагает скорректированные условия после проверки предоставленных данных.",
        internalReason,
      });
      expect(database.prepare("SELECT comment FROM application_events WHERE application_id = ? AND to_status = 'OFFER'").get(applicationId))
        .toEqual({ comment: internalReason });
      expect(database.prepare("SELECT from_status, to_status, actor, comment FROM application_events WHERE application_id = ? ORDER BY id DESC LIMIT 1").get(applicationId))
        .toEqual({
          from_status: "READY_FOR_ISSUANCE",
          to_status: "SIGNING",
          actor: "Система",
          comment: "Прежний пакет документов перемещён в недоступный архив. Сформирован безопасный пакет для повторного ознакомления и подписания.",
        });
      const documents = database.prepare(`
        SELECT status, document_version, content_hash, content_text, opened_by, acknowledged_by, signed_by
        FROM documents WHERE application_id = ? ORDER BY id
      `).all(applicationId) as Array<Record<string, unknown>>;
      expect(documents).toHaveLength(6);
      expect(documents.slice(0, 3).every((document, index) => document.status === "UNAVAILABLE"
        && document.document_version === "legacy-unavailable-v2"
        && document.content_hash === legacyDocuments[index]?.contentHash
        && document.content_text === null
        && document.opened_by === clientId
        && document.acknowledged_by === clientId
        && document.signed_by === clientId)).toBe(true);
      expect(documents.slice(3).every((document) => document.status === "GENERATED"
        && document.document_version === "credit-docs-v2"
        && typeof document.content_text === "string"
        && !(document.content_text as string).includes(internalReason)
        && documentContentHash(document.content_text as string) === document.content_hash
        && document.opened_by === null
        && document.acknowledged_by === null
        && document.signed_by === null)).toBe(true);
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("rolls back a failed migration and keeps the previous version", () => {
    const database = memoryDatabase();
    try {
      runMigrations(database);
      const failingMigration: SchemaMigration = {
        version: LATEST_SCHEMA_VERSION + 1,
        name: "intentional_failure",
        up(connection) {
          connection.exec("CREATE TABLE migration_should_rollback (id INTEGER PRIMARY KEY)");
          throw new Error("migration failed");
        },
      };

      expect(() => runMigrations(database, [...SCHEMA_MIGRATIONS, failingMigration])).toThrow("migration failed");
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_should_rollback'").get()).toBeUndefined();
      expect(database.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(failingMigration.version)).toBeUndefined();
      expect(database.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      database.close();
    }
  });
});
