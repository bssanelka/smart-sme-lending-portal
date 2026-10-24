import type Database from "better-sqlite3";
import { buildDecisionEconomics, requireDecisionEconomicsSnapshot } from "./calculator";
import { buildDocumentPackage } from "./document-templates";
import { defaultClientDecisionComment, type FinalDecisionType } from "./decision-text";

export interface SchemaMigration {
  version: number;
  name: string;
  up: (database: Database.Database) => void;
}

function tableColumns(database: Database.Database, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

const initialSchema: SchemaMigration = {
  version: 1,
  name: "initial_credit_cabinet_schema",
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        form TEXT NOT NULL CHECK (form IN ('ИП','ООО','АО')),
        inn TEXT UNIQUE NOT NULL,
        ogrn TEXT NOT NULL,
        okved_code TEXT NOT NULL,
        okved_name TEXT NOT NULL,
        reg_date TEXT NOT NULL,
        address TEXT NOT NULL,
        head_name TEXT NOT NULL,
        segment TEXT NOT NULL DEFAULT 'micro'
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('CLIENT','BANK')),
        company_id INTEGER,
        position TEXT
      );

      CREATE TABLE IF NOT EXISTS financials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        year INTEGER NOT NULL,
        revenue REAL NOT NULL,
        profit REAL NOT NULL,
        own_capital REAL NOT NULL,
        monthly_obligations REAL NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS credit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        bki_score INTEGER NOT NULL,
        active_credits INTEGER NOT NULL DEFAULT 0,
        total_debt REAL NOT NULL DEFAULT 0,
        overdue_count INTEGER NOT NULL DEFAULT 0,
        worst_delay_days INTEGER NOT NULL DEFAULT 0,
        monthly_payment REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL,
        description TEXT NOT NULL,
        min_amount REAL NOT NULL,
        max_amount REAL NOT NULL,
        rate_from REAL NOT NULL,
        term_min INTEGER NOT NULL,
        term_max INTEGER NOT NULL,
        purpose_tags TEXT NOT NULL DEFAULT '',
        features TEXT NOT NULL DEFAULT '[]',
        min_revenue REAL NOT NULL DEFAULT 0,
        auto_decision_grades TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS calculator_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        company_id INTEGER NOT NULL REFERENCES companies(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        input_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_no TEXT UNIQUE NOT NULL,
        client_id INTEGER NOT NULL REFERENCES users(id),
        company_id INTEGER NOT NULL REFERENCES companies(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        amount REAL NOT NULL,
        term_months INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        purpose_category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SUBMITTED',
        score INTEGER,
        grade TEXT,
        score_details TEXT,
        decision TEXT,
        decided_by INTEGER,
        decided_at TEXT,
        client_comment TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS application_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications(id),
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications(id),
        kind TEXT NOT NULL,
        filename TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UPLOADED',
        extracted TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER REFERENCES applications(id),
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'template',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_app_client ON applications(client_id);
      CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
      CREATE INDEX IF NOT EXISTS idx_events_app ON application_events(application_id);
      CREATE INDEX IF NOT EXISTS idx_calculator_user ON calculator_runs(user_id, created_at);
    `);
  },
};

const calculationSource: SchemaMigration = {
  version: 2,
  name: "application_calculation_source",
  up(database) {
    const columns = tableColumns(database, "applications");
    if (!columns.has("source_calculation_id")) {
      database.exec("ALTER TABLE applications ADD COLUMN source_calculation_id INTEGER REFERENCES calculator_runs(id)");
    }
    database.exec("CREATE INDEX IF NOT EXISTS idx_app_source_calculation ON applications(source_calculation_id)");
  },
};

const scorecardAndIdempotency: SchemaMigration = {
  version: 3,
  name: "scorecard_version_and_calculation_idempotency",
  up(database) {
    const columns = tableColumns(database, "applications");
    if (!columns.has("scorecard_version")) {
      database.exec("ALTER TABLE applications ADD COLUMN scorecard_version TEXT");
    }
    const duplicate = database.prepare(`
      SELECT source_calculation_id, GROUP_CONCAT(public_no) AS public_numbers
      FROM applications
      WHERE source_calculation_id IS NOT NULL
      GROUP BY source_calculation_id
      HAVING COUNT(*) > 1
      LIMIT 1
    `).get() as { source_calculation_id: number; public_numbers: string } | undefined;
    if (duplicate) {
      throw new Error(
        `Нельзя включить одноразовые расчёты: calculation_id=${duplicate.source_calculation_id} уже используется заявками ${duplicate.public_numbers}. Требуется ручная проверка без удаления данных.`,
      );
    }
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_app_source_calculation_unique ON applications(source_calculation_id) WHERE source_calculation_id IS NOT NULL");
  },
};

const externalChecks: SchemaMigration = {
  version: 4,
  name: "external_check_snapshots",
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS external_check_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications(id),
        kind TEXT NOT NULL CHECK (kind IN ('BKI','BUSINESS_REGISTRY')),
        provider TEXT NOT NULL,
        provider_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('SUCCESS','NOT_FOUND','ERROR')),
        subject_key TEXT NOT NULL,
        payload_json TEXT,
        requested_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_external_checks_app_kind
        ON external_check_snapshots(application_id, kind, id);
    `);
  },
};

const recommendationsAndSeedMetadata: SchemaMigration = {
  version: 5,
  name: "recommendation_snapshots_and_seed_metadata",
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS recommendation_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications(id),
        scorecard_version TEXT NOT NULL,
        score INTEGER NOT NULL,
        grade TEXT NOT NULL CHECK (grade IN ('A','B','C','D')),
        factors_json TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        calculated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recommendations_app
        ON recommendation_snapshots(application_id, id);

      CREATE TABLE IF NOT EXISTS seed_metadata (
        seed_key TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  },
};

function jsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function nestedObject(parent: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = parent[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function addMissingTotalPayment(variant: Record<string, unknown> | null, amount: unknown): boolean {
  if (!variant || Object.hasOwn(variant, "totalPayment")) return false;
  const overpayment = variant.overpayment;
  if (typeof amount !== "number" || !Number.isFinite(amount) || typeof overpayment !== "number" || !Number.isFinite(overpayment)) return false;
  variant.totalPayment = Math.round((amount + overpayment) * 100) / 100;
  return true;
}

const completeOfferEconomics: SchemaMigration = {
  version: 6,
  name: "complete_offer_economics",
  up(database) {
    const calculatorRows = database.prepare("SELECT id, input_json, result_json FROM calculator_runs").all() as Array<{
      id: number; input_json: string; result_json: string;
    }>;
    const updateCalculation = database.prepare("UPDATE calculator_runs SET result_json = ? WHERE id = ?");
    for (const row of calculatorRows) {
      const input = jsonObject(row.input_json);
      const snapshot = jsonObject(row.result_json);
      if (!input || !snapshot) continue;
      const evaluation = nestedObject(snapshot, "result");
      if (!evaluation) continue;
      const changedCurrent = addMissingTotalPayment(nestedObject(evaluation, "current"), input.amount);
      const changedScenario = addMissingTotalPayment(nestedObject(evaluation, "scenario"), input.amount);
      if (changedCurrent || changedScenario) updateCalculation.run(JSON.stringify(snapshot), row.id);
    }

    const applicationRows = database.prepare(`
      SELECT id, decision, decided_at, updated_at
      FROM applications
      WHERE decision IS NOT NULL
    `).all() as Array<{ id: number; decision: string; decided_at: string | null; updated_at: string }>;
    const updateDecision = database.prepare("UPDATE applications SET decision = ? WHERE id = ?");
    for (const row of applicationRows) {
      const decision = jsonObject(row.decision);
      if (!decision || (decision.type !== "APPROVE" && decision.type !== "CONDITIONS")) continue;
      const amount = decision.amount;
      const rate = decision.rate;
      const termMonths = decision.termMonths;
      const decidedAt = typeof decision.decidedAt === "string" ? decision.decidedAt : row.decided_at ?? row.updated_at;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0
        || typeof rate !== "number" || !Number.isFinite(rate) || rate < 0
        || typeof termMonths !== "number" || !Number.isInteger(termMonths) || termMonths <= 0
        || !Number.isFinite(Date.parse(decidedAt))) continue;

      const economics = buildDecisionEconomics(amount, rate, termMonths, decidedAt);
      let changed = false;
      for (const [key, value] of Object.entries(economics)) {
        if (!Object.hasOwn(decision, key)) {
          decision[key] = value;
          changed = true;
        }
      }
      const preliminaryTerms = nestedObject(decision, "preliminaryTerms");
      if (preliminaryTerms && addMissingTotalPayment(preliminaryTerms, preliminaryTerms.amount)) changed = true;
      if (changed) updateDecision.run(JSON.stringify(decision), row.id);
    }
  },
};

const typedMoreInfo: SchemaMigration = {
  version: 7,
  name: "typed_more_info_requests",
  up(database) {
    const recommendationColumns = tableColumns(database, "recommendation_snapshots");
    if (!recommendationColumns.has("superseded_at")) {
      database.exec("ALTER TABLE recommendation_snapshots ADD COLUMN superseded_at TEXT");
    }
    if (!recommendationColumns.has("superseded_by_request_id")) {
      database.exec("ALTER TABLE recommendation_snapshots ADD COLUMN superseded_by_request_id INTEGER");
    }

    database.exec(`
      CREATE TABLE IF NOT EXISTS more_info_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications(id),
        request_type TEXT NOT NULL CHECK (request_type IN ('FINANCIALS','DOCUMENT','COMMENT','BKI_CONSENT','COMPANY_DATA','SYSTEM_RETRY')),
        reason TEXT NOT NULL,
        required_fields_json TEXT NOT NULL DEFAULT '[]',
        required_files_json TEXT NOT NULL DEFAULT '[]',
        due_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('WAITING_CLIENT','CLIENT_RESPONDED','RECHECK','CLOSED','CANCELLED')),
        source TEXT NOT NULL CHECK (source IN ('SYSTEM','BANK')),
        requested_by INTEGER,
        created_at TEXT NOT NULL,
        responded_at TEXT,
        closed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_more_info_one_active
        ON more_info_requests(application_id)
        WHERE status IN ('WAITING_CLIENT','CLIENT_RESPONDED','RECHECK');
      CREATE INDEX IF NOT EXISTS idx_more_info_application
        ON more_info_requests(application_id, id);

      CREATE TABLE IF NOT EXISTS more_info_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL UNIQUE REFERENCES more_info_requests(id),
        application_id INTEGER NOT NULL REFERENCES applications(id),
        response_type TEXT NOT NULL,
        response_json TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('CLIENT','SYSTEM','BANK')),
        submitted_by INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_more_info_responses_application
        ON more_info_responses(application_id, id);
    `);

    const legacyRows = database.prepare(`
      SELECT id, decision, decided_by, updated_at
      FROM applications
      WHERE status = 'MORE_INFO'
    `).all() as Array<{ id: number; decision: string | null; decided_by: number | null; updated_at: string }>;
    const insertRequest = database.prepare(`
      INSERT INTO more_info_requests (
        application_id, request_type, reason, required_fields_json, required_files_json,
        due_at, status, source, requested_by, created_at
      ) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)
    `);
    for (const row of legacyRows) {
      const decision = row.decision ? jsonObject(row.decision) : null;
      const reason = typeof decision?.reason === "string" && decision.reason.trim()
        ? decision.reason.trim()
        : "Требуется дополнительная информация для продолжения рассмотрения";
      const normalized = reason.toLowerCase();
      const requestType = normalized.includes("финанс") ? "FINANCIALS"
        : normalized.includes("бки") || normalized.includes("егрюл") || normalized.includes("егрип") || normalized.includes("реестр") ? "SYSTEM_RETRY"
        : "COMMENT";
      const requiredFields = requestType === "FINANCIALS"
        ? ["year", "revenue", "profit", "own_capital", "monthly_obligations"]
        : requestType === "COMMENT" ? ["comment"] : [];
      const createdAt = Number.isFinite(Date.parse(row.updated_at)) ? row.updated_at : new Date().toISOString();
      const dueAt = new Date(createdAt);
      dueAt.setUTCDate(dueAt.getUTCDate() + (requestType === "SYSTEM_RETRY" ? 2 : 5));
      const result = insertRequest.run(
        row.id,
        requestType,
        reason,
        JSON.stringify(requiredFields),
        dueAt.toISOString(),
        requestType === "SYSTEM_RETRY" ? "RECHECK" : "WAITING_CLIENT",
        decision?.type === "MORE_INFO" ? "BANK" : "SYSTEM",
        row.decided_by,
        createdAt,
      );
      const requestId = Number(result.lastInsertRowid);
      database.prepare(`
        UPDATE recommendation_snapshots
        SET superseded_at = ?, superseded_by_request_id = ?
        WHERE id = (
          SELECT id FROM recommendation_snapshots
          WHERE application_id = ? AND superseded_at IS NULL
          ORDER BY id DESC LIMIT 1
        )
      `).run(createdAt, requestId, row.id);
      if (decision?.type === "MORE_INFO") {
        database.prepare("UPDATE applications SET decision = NULL, decided_by = NULL, decided_at = NULL WHERE id = ?").run(row.id);
      }
    }
  },
};

const financialReportProvenance: SchemaMigration = {
  version: 8,
  name: "financial_report_provenance",
  up(database) {
    const recommendationColumns = tableColumns(database, "recommendation_snapshots");
    if (!recommendationColumns.has("financial_report_snapshot_json")) {
      database.exec("ALTER TABLE recommendation_snapshots ADD COLUMN financial_report_snapshot_json TEXT");
    }

    database.exec(`
      CREATE TABLE IF NOT EXISTS financial_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        application_id INTEGER REFERENCES applications(id),
        source_financial_id INTEGER UNIQUE REFERENCES financials(id),
        reporting_year INTEGER NOT NULL,
        revenue REAL NOT NULL,
        profit REAL NOT NULL,
        own_capital REAL NOT NULL,
        monthly_obligations REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('SUBMITTED','VERIFIED','REJECTED')),
        source TEXT NOT NULL CHECK (source IN ('CLIENT','BANK','DEMO_SEED','LEGACY')),
        submitted_by INTEGER REFERENCES users(id),
        verified_by INTEGER REFERENCES users(id),
        submitted_at TEXT NOT NULL,
        verified_at TEXT,
        rejected_at TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        CHECK (source = 'LEGACY' OR revenue >= 0),
        CHECK (source = 'LEGACY' OR own_capital >= 0),
        CHECK (source = 'LEGACY' OR monthly_obligations >= 0),
        CHECK (source = 'LEGACY' OR profit <= revenue),
        CHECK (source = 'LEGACY' OR revenue != 0 OR profit = 0),
        CHECK (status != 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
        CHECK (status != 'REJECTED' OR (rejected_at IS NOT NULL AND rejection_reason IS NOT NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_reports_active_period
        ON financial_reports(company_id, reporting_year)
        WHERE status IN ('SUBMITTED','VERIFIED');
      CREATE INDEX IF NOT EXISTS idx_financial_reports_company
        ON financial_reports(company_id, reporting_year DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_financial_reports_application
        ON financial_reports(application_id, id DESC);
    `);

    const migratedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO financial_reports (
        company_id, application_id, source_financial_id, reporting_year, revenue, profit,
        own_capital, monthly_obligations, status, source, submitted_at,
        rejected_at, rejection_reason, created_at
      )
      SELECT
        f.company_id,
        NULL,
        f.id,
        f.year,
        f.revenue,
        f.profit,
        f.own_capital,
        f.monthly_obligations,
        CASE WHEN f.revenue >= 0
          AND f.own_capital >= 0
          AND f.monthly_obligations >= 0
          AND f.profit <= f.revenue
          AND (f.revenue != 0 OR f.profit = 0)
          AND f.id = (
            SELECT MAX(latest.id) FROM financials latest
            WHERE latest.company_id = f.company_id AND latest.year = f.year
          ) THEN 'SUBMITTED' ELSE 'REJECTED' END,
        'LEGACY',
        ?,
        CASE WHEN f.revenue >= 0
          AND f.own_capital >= 0
          AND f.monthly_obligations >= 0
          AND f.profit <= f.revenue
          AND (f.revenue != 0 OR f.profit = 0)
          AND f.id = (
            SELECT MAX(latest.id) FROM financials latest
            WHERE latest.company_id = f.company_id AND latest.year = f.year
          ) THEN NULL ELSE ? END,
        CASE WHEN f.revenue < 0
          OR f.own_capital < 0
          OR f.monthly_obligations < 0
          OR f.profit > f.revenue
          OR (f.revenue = 0 AND f.profit != 0)
          THEN 'Legacy-данные не прошли доменную проверку и сохранены только для аудита'
          WHEN f.id != (
            SELECT MAX(latest.id) FROM financials latest
            WHERE latest.company_id = f.company_id AND latest.year = f.year
          ) THEN 'Legacy-дубликат периода сохранён в архиве'
          ELSE NULL END,
        ?
      FROM financials f
      WHERE NOT EXISTS (
        SELECT 1 FROM financial_reports report WHERE report.source_financial_id = f.id
      )
    `).run(migratedAt, migratedAt, migratedAt);
  },
};

const verifiableDocumentPackage: SchemaMigration = {
  version: 9,
  name: "verifiable_document_package",
  up(database) {
    const columns = tableColumns(database, "documents");
    const additions = [
      ["document_version", "TEXT"],
      ["content_hash", "TEXT"],
      ["content_text", "TEXT"],
      ["opened_at", "TEXT"],
      ["opened_by", "INTEGER REFERENCES users(id)"],
      ["acknowledged_at", "TEXT"],
      ["acknowledged_by", "INTEGER REFERENCES users(id)"],
      ["signed_at", "TEXT"],
      ["signed_by", "INTEGER REFERENCES users(id)"],
    ] as const;
    for (const [name, definition] of additions) {
      if (!columns.has(name)) database.exec(`ALTER TABLE documents ADD COLUMN ${name} ${definition}`);
    }

    const rows = database.prepare(`
      SELECT d.id, d.kind, d.created_at,
        a.public_no, a.purpose, a.decision, a.decided_at,
        c.name AS company_name, c.inn AS company_inn, c.head_name AS company_head_name,
        p.name AS source_product_name
      FROM documents d
      JOIN applications a ON a.id = d.application_id
      JOIN companies c ON c.id = a.company_id
      JOIN products p ON p.id = a.product_id
      WHERE d.content_text IS NULL OR d.content_hash IS NULL OR d.document_version IS NULL
      ORDER BY d.id
    `).all() as Array<Record<string, unknown>>;
    const update = database.prepare(`
      UPDATE documents
      SET filename = ?, document_version = ?, content_hash = ?, content_text = ?
      WHERE id = ?
    `);
    const markUnavailable = database.prepare(`
      UPDATE documents SET document_version = 'legacy-unavailable-v1' WHERE id = ?
    `);

    for (const row of rows) {
      const decision = typeof row.decision === "string" ? jsonObject(row.decision) : null;
      if (!decision) {
        markUnavailable.run(row.id);
        continue;
      }
      try {
        const economics = requireDecisionEconomicsSnapshot(decision);
        const generated = buildDocumentPackage({
          publicNo: row.public_no as string,
          companyName: row.company_name as string,
          companyInn: row.company_inn as string,
          companyHeadName: row.company_head_name as string,
          productName: typeof decision.productName === "string" ? decision.productName : row.source_product_name as string,
          purpose: row.purpose as string,
          decisionReason: typeof decision.reason === "string" ? decision.reason : null,
          decidedAt: typeof decision.decidedAt === "string" ? decision.decidedAt : row.decided_at as string,
          generatedAt: row.created_at as string,
          economics,
        }).find((document) => document.kind === row.kind);
        if (!generated) {
          markUnavailable.run(row.id);
          continue;
        }
        update.run(generated.filename, generated.version, generated.contentHash, generated.content, row.id);
      } catch {
        markUnavailable.run(row.id);
      }
    }

    database.exec(`
      UPDATE documents
      SET signed_at = COALESCE(signed_at, (
            SELECT e.created_at FROM application_events e
            WHERE e.application_id = documents.application_id AND e.to_status = 'ISSUED'
            ORDER BY e.id DESC LIMIT 1
          ), created_at),
          signed_by = COALESCE(signed_by, (
            SELECT a.client_id FROM applications a WHERE a.id = documents.application_id
          ))
      WHERE status = 'SIGNED';

      CREATE INDEX IF NOT EXISTS idx_documents_application_status
        ON documents(application_id, status, id);
    `);
  },
};

const separateSigningAndIssuance: SchemaMigration = {
  version: 10,
  name: "separate_signing_and_issuance",
  up(database) {
    const columns = tableColumns(database, "applications");
    const additions = [
      ["signed_at", "TEXT"],
      ["signed_by", "INTEGER REFERENCES users(id)"],
      ["issued_at", "TEXT"],
      ["issued_by", "INTEGER REFERENCES users(id)"],
      ["issuance_mode", "TEXT"],
    ] as const;
    for (const [name, definition] of additions) {
      if (!columns.has(name)) database.exec(`ALTER TABLE applications ADD COLUMN ${name} ${definition}`);
    }

    database.exec(`
      UPDATE applications
      SET signed_at = COALESCE(signed_at, (
            SELECT e.created_at FROM application_events e
            WHERE e.application_id = applications.id AND e.to_status = 'ISSUED'
            ORDER BY e.id DESC LIMIT 1
          ), updated_at),
          signed_by = COALESCE(signed_by, client_id),
          issued_at = COALESCE(issued_at, (
            SELECT e.created_at FROM application_events e
            WHERE e.application_id = applications.id AND e.to_status = 'ISSUED'
            ORDER BY e.id DESC LIMIT 1
          ), updated_at),
          issuance_mode = COALESCE(issuance_mode, 'LEGACY_COMBINED')
      WHERE status = 'ISSUED';
    `);
  },
};

export const commandIdempotency: SchemaMigration = {
  version: 11,
  name: "command_idempotency",
  up(database) {
    database.exec(`
      CREATE TABLE idempotency_records (
        user_id INTEGER NOT NULL REFERENCES users(id),
        idempotency_key TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, idempotency_key)
      );

      CREATE INDEX idx_idempotency_created_at
        ON idempotency_records(created_at);
    `);
  },
};

const separateDecisionNarratives: SchemaMigration = {
  version: 12,
  name: "separate_internal_and_client_decision_text",
  up(database) {
    const rows = database.prepare(`
      SELECT a.id, a.status, a.decision, a.decided_at, a.updated_at, a.public_no, a.purpose,
        c.name AS company_name, c.inn AS company_inn, c.head_name AS company_head_name,
        p.name AS source_product_name
      FROM applications a
      JOIN companies c ON c.id = a.company_id
      JOIN products p ON p.id = a.product_id
      WHERE a.decision IS NOT NULL
    `).all() as Array<Record<string, unknown>>;
    const updateDecision = database.prepare("UPDATE applications SET decision = ? WHERE id = ?");
    const quarantineLegacyDocuments = database.prepare(`
      UPDATE documents
      SET status = 'UNAVAILABLE', document_version = 'legacy-unavailable-v2', content_text = NULL
      WHERE application_id = ?
    `);
    const insertDocument = database.prepare(`
      INSERT INTO documents (
        application_id, kind, filename, status, document_version, content_hash, content_text, created_at
      ) VALUES (?, ?, ?, 'GENERATED', ?, ?, ?, ?)
    `);
    const resetForSigning = database.prepare(`
      UPDATE applications
      SET status = 'SIGNING', signed_at = NULL, signed_by = NULL, updated_at = ?
      WHERE id = ?
    `);
    const resetForDecision = database.prepare(`
      UPDATE applications
      SET status = 'DECISION', decision = NULL, decided_by = NULL, decided_at = NULL,
        signed_at = NULL, signed_by = NULL, updated_at = ?
      WHERE id = ?
    `);
    const addRecoveryEvent = database.prepare(`
      INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at)
      VALUES (?, ?, ?, 'Система', ?, ?)
    `);

    for (const row of rows) {
      const decision = jsonObject(row.decision as string);
      if (!decision || typeof decision.clientComment === "string") continue;
      if (decision.type !== "APPROVE" && decision.type !== "CONDITIONS" && decision.type !== "REJECT") continue;

      const decisionType = decision.type as FinalDecisionType;
      const legacyReason = typeof decision.reason === "string" && decision.reason.trim().length > 0
        ? decision.reason.trim()
        : "Историческое внутреннее обоснование отсутствует.";
      const clientComment = defaultClientDecisionComment(decisionType);
      decision.internalReason = typeof decision.internalReason === "string" && decision.internalReason.trim().length > 0
        ? decision.internalReason
        : legacyReason;
      decision.clientComment = clientComment;
      decision.reason = clientComment;
      updateDecision.run(JSON.stringify(decision), row.id);
      quarantineLegacyDocuments.run(row.id);

      if (row.status !== "SIGNING" && row.status !== "READY_FOR_ISSUANCE") continue;
      const migratedAt = new Date().toISOString();
      try {
        const economics = requireDecisionEconomicsSnapshot(decision);
        const decidedAt = typeof decision.decidedAt === "string"
          ? decision.decidedAt
          : typeof row.decided_at === "string" ? row.decided_at : row.updated_at as string;
        const documents = buildDocumentPackage({
          publicNo: row.public_no as string,
          companyName: row.company_name as string,
          companyInn: row.company_inn as string,
          companyHeadName: row.company_head_name as string,
          productName: typeof decision.productName === "string" ? decision.productName : row.source_product_name as string,
          purpose: row.purpose as string,
          decisionReason: clientComment,
          decidedAt,
          generatedAt: migratedAt,
          economics,
        });
        for (const document of documents) {
          insertDocument.run(
            row.id,
            document.kind,
            document.filename,
            document.version,
            document.contentHash,
            document.content,
            migratedAt,
          );
        }
        resetForSigning.run(migratedAt, row.id);
        addRecoveryEvent.run(
          row.id,
          row.status,
          "SIGNING",
          "Прежний пакет документов перемещён в недоступный архив. Сформирован безопасный пакет для повторного ознакомления и подписания.",
          migratedAt,
        );
      } catch {
        resetForDecision.run(migratedAt, row.id);
        addRecoveryEvent.run(
          row.id,
          row.status,
          "DECISION",
          "Прежний пакет документов перемещён в недоступный архив. Для продолжения сотруднику банка необходимо сформировать новое решение.",
          migratedAt,
        );
      }
    }
  },
};

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  initialSchema,
  calculationSource,
  scorecardAndIdempotency,
  externalChecks,
  recommendationsAndSeedMetadata,
  completeOfferEconomics,
  typedMoreInfo,
  financialReportProvenance,
  verifiableDocumentPackage,
  separateSigningAndIssuance,
  commandIdempotency,
  separateDecisionNarratives,
];

export const LATEST_SCHEMA_VERSION = SCHEMA_MIGRATIONS.at(-1)?.version ?? 0;

export function runMigrations(
  database: Database.Database,
  migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const currentRows = database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{ version: number; name: string }>;
  const appliedVersions = new Set(currentRows.map((row) => row.version));
  const highestKnownVersion = migrations.at(-1)?.version ?? 0;
  const unexpected = currentRows.find((row) => row.version > highestKnownVersion);
  if (unexpected) {
    throw new Error(`Версия схемы ${unexpected.version} новее поддерживаемой ${highestKnownVersion}`);
  }

  let applied = 0;
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    const apply = database.transaction(() => {
      migration.up(database);
      database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
      database.pragma(`user_version = ${migration.version}`);
    });
    apply.immediate();
    applied += 1;
  }

  const recordedVersion = database.pragma("user_version", { simple: true }) as number;
  const finalVersion = migrations.at(-1)?.version ?? recordedVersion;
  if (recordedVersion !== finalVersion) {
    database.pragma(`user_version = ${finalVersion}`);
  }
  return applied;
}
