import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { annuityOverpayment, annuityPayment } from "../server/calculator";
import { SCORECARD_VERSION } from "../server/scoring";

type ServerDb = typeof import("../server/db");
type Conveyor = typeof import("../server/conveyor");
type Documents = typeof import("../server/documents");

let database: ServerDb["db"];
let conveyor: Conveyor;
let documents: Documents;
let dataDir: string;
let fixtureNumber = 0;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "alfa-conveyor-"));
  process.env.DATA_DIR = dataDir;
  ({ db: database } = await import("../server/db"));
  conveyor = await import("../server/conveyor");
  documents = await import("../server/documents");
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

interface FixtureOptions {
  autoGrades: string[];
  regDate: string;
  revenue: number;
  profit: number;
  obligations: number;
  bkiScore: number;
  overdueCount: number;
  worstDelayDays: number;
  monthlyPayment: number;
  amount: number;
  termMonths?: number;
}

function createApplication(options: FixtureOptions): number {
  fixtureNumber += 1;
  const companyId = Number(database.prepare(`
    INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment)
    VALUES (?, 'ООО', ?, ?, '62.01', 'Разработка ПО', ?, 'Москва', 'Тест Тестов', 'micro')
  `).run(`Компания ${fixtureNumber}`, String(7_700_000_000 + fixtureNumber), String(1_000_000_000_000 + fixtureNumber), options.regDate).lastInsertRowid);
  const userId = Number(database.prepare(`
    INSERT INTO users (login, password, name, role, company_id, position)
    VALUES (?, 'test', 'Тест Тестов', 'CLIENT', ?, 'Директор')
  `).run(`client-${fixtureNumber}`, companyId).lastInsertRowid);
  const bankUserId = Number(database.prepare(`
    INSERT INTO users (login, password, name, role, company_id, position)
    VALUES (?, 'test', 'Тестовый аналитик', 'BANK', NULL, 'Кредитный аналитик')
  `).run(`bank-${fixtureNumber}`).lastInsertRowid);
  const sourceFinancialId = Number(database.prepare(`
    INSERT INTO financials (company_id, year, revenue, profit, own_capital, monthly_obligations)
    VALUES (?, 2025, ?, ?, 1000000, ?)
  `).run(companyId, options.revenue, options.profit, options.obligations).lastInsertRowid);
  const reportTimestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO financial_reports (
      company_id, source_financial_id, reporting_year, revenue, profit, own_capital,
      monthly_obligations, status, source, submitted_by, verified_by, submitted_at, verified_at, created_at
    ) VALUES (?, ?, 2025, ?, ?, 1000000, ?, 'VERIFIED', 'BANK', ?, ?, ?, ?, ?)
  `).run(companyId, sourceFinancialId, options.revenue, options.profit, options.obligations, bankUserId, bankUserId, reportTimestamp, reportTimestamp, reportTimestamp);
  database.prepare(`
    INSERT INTO credit_history (company_id, bki_score, active_credits, total_debt, overdue_count, worst_delay_days, monthly_payment, updated_at)
    VALUES (?, ?, 1, 100000, ?, ?, ?, ?)
  `).run(companyId, options.bkiScore, options.overdueCount, options.worstDelayDays, options.monthlyPayment, new Date().toISOString());
  const productId = Number(database.prepare(`
    INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max, auto_decision_grades)
    VALUES (?, 'Тестовый кредит', 'Тест', 'Тест', 1, 100000000, 20, 1, 120, ?)
  `).run(`product-${fixtureNumber}`, JSON.stringify(options.autoGrades)).lastInsertRowid);

  return Number(database.prepare(`
    INSERT INTO applications (public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'Тестовая цель кредита', 'оборотные средства', 'SUBMITTED', ?, ?)
  `).run(`TEST-${fixtureNumber}`, userId, companyId, productId, options.amount, options.termMonths ?? 12, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
}

function application(id: number) {
  return database.prepare("SELECT * FROM applications WHERE id = ?").get(id) as Record<string, unknown>;
}

function bankUserId(id: number): number {
  const row = application(id);
  const fixtureId = String(row.public_no).replace("TEST-", "");
  return (database.prepare("SELECT id FROM users WHERE login = ? AND role = 'BANK'").get(`bank-${fixtureId}`) as { id: number }).id;
}

const APPROVAL_INTERNAL_REASON = "Проверка риск-факторов и подтверждённой отчётности пройдена по внутренней методике.";
const APPROVAL_CLIENT_COMMENT = "Банк одобрил заявку на запрошенных условиях.";

function approveByBank(id: number) {
  const row = application(id);
  const product = database.prepare("SELECT id, name, rate_from FROM products WHERE id = ?").get(row.product_id) as { id: number; name: string; rate_from: number }; 
  conveyor.applyDecision(id, {
    type: "APPROVE",
    rate: product.rate_from,
    amount: row.amount as number,
    termMonths: row.term_months as number,
    reason: APPROVAL_CLIENT_COMMENT,
    internalReason: APPROVAL_INTERNAL_REASON,
    clientComment: APPROVAL_CLIENT_COMMENT,
    productId: product.id,
    productName: product.name,
  }, "Тестовый аналитик", bankUserId(id));
}

describe("credit conveyor", () => {
  it("leaves grade D for a final bank decision", () => {
    const id = createApplication({
      autoGrades: ["A", "B"],
      regDate: "2025-01-01",
      revenue: 6_500_000,
      profit: -800_000,
      obligations: 90_000,
      bkiScore: 498,
      overdueCount: 3,
      worstDelayDays: 74,
      monthlyPayment: 62_000,
      amount: 2_500_000,
    });

    conveyor.runConveyor(id);

    const row = application(id);
    expect(row.grade).toBe("D");
    expect(row.scorecard_version).toBe(SCORECARD_VERSION);
    expect(row.status).toBe("DECISION");
    expect(row.decision).toBeNull();

    const recommendation = conveyor.getStoredRecommendation(id);
    expect(recommendation).toMatchObject({
      applicationId: id,
      scorecardVersion: SCORECARD_VERSION,
      score: row.score,
      grade: "D",
      proposal: { type: "REJECT" },
    });
    const stateBeforeReads = {
      application: application(id),
      events: database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(id),
      recommendations: database.prepare("SELECT COUNT(*) AS count FROM recommendation_snapshots WHERE application_id = ?").get(id),
    };
    expect(conveyor.getStoredRecommendation(id)).toEqual(recommendation);
    expect(conveyor.getStoredRecommendation(id)).toEqual(recommendation);
    expect({
      application: application(id),
      events: database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(id),
      recommendations: database.prepare("SELECT COUNT(*) AS count FROM recommendation_snapshots WHERE application_id = ?").get(id),
    }).toEqual(stateBeforeReads);

    const checks = database.prepare(`
      SELECT kind, status, provider, provider_version
      FROM external_check_snapshots
      WHERE application_id = ?
      ORDER BY kind
    `).all(id) as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(2);
    expect(checks.every((check) => check.status === "SUCCESS")).toBe(true);
    expect(checks.every((check) => typeof check.provider === "string" && typeof check.provider_version === "string")).toBe(true);

    database.prepare("UPDATE credit_history SET bki_score = 850 WHERE company_id = ?").run(row.company_id);
    expect(conveyor.buildScoringInput(row).bkiScore).toBe(498);
    expect(database.prepare("SELECT from_status, to_status FROM application_events WHERE application_id = ? ORDER BY id DESC LIMIT 1").get(id))
      .toEqual({ from_status: "SCORING", to_status: "DECISION" });
  });

  it("leaves grade C for a bank decision even when product configuration contains C", () => {
    const id = createApplication({
      autoGrades: ["C"],
      regDate: "2024-01-01",
      revenue: 5_000_000,
      profit: 500_000,
      obligations: 100_000,
      bkiScore: 650,
      overdueCount: 1,
      worstDelayDays: 10,
      monthlyPayment: 66_667,
      amount: 2_000_000,
      termMonths: 36,
    });

    conveyor.runConveyor(id);

    const row = application(id);
    expect(row.grade).toBe("C");
    expect(row.status).toBe("DECISION");
    expect(row.decision).toBeNull();
  });

  it("requires a bank decision before offer, signing, and issue", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
    });

    conveyor.runConveyor(id);
    expect(application(id).status).toBe("DECISION");

    approveByBank(id);
    expect(application(id).status).toBe("OFFER");
    expect(application(id).decided_by).toBe(bankUserId(id));
    expect(JSON.parse(application(id).decision as string)).toMatchObject({
      internalReason: APPROVAL_INTERNAL_REASON,
      clientComment: APPROVAL_CLIENT_COMMENT,
      reason: APPROVAL_CLIENT_COMMENT,
    });
    expect(database.prepare("SELECT comment FROM application_events WHERE application_id = ? ORDER BY id DESC LIMIT 1").get(id))
      .toEqual({ comment: APPROVAL_CLIENT_COMMENT });

    conveyor.clientAcceptOffer(id);
    expect(application(id).status).toBe("SIGNING");
    const generated = documents.listDocumentMetadata(id);
    expect(generated).toHaveLength(3);
    expect(new Set(generated.map((document) => document.content_hash)).size).toBe(3);
    expect(generated.every((document) => document.document_version === "credit-docs-v2")).toBe(true);
    const contract = generated.find((document) => document.kind === "Кредитный договор");
    expect(contract).toBeDefined();
    const contractContent = documents.downloadableDocument(contract!.id).content;
    expect(contractContent).toContain(APPROVAL_CLIENT_COMMENT);
    expect(contractContent).not.toContain(APPROVAL_INTERNAL_REASON);
    database.prepare(`
      INSERT INTO documents (
        application_id, kind, filename, status, document_version, content_hash, content_text, created_at
      ) VALUES (?, 'Кредитный договор', 'legacy-contract.txt', 'UNAVAILABLE',
        'legacy-unavailable-v2', 'legacy-hash', NULL, ?)
    `).run(id, new Date().toISOString());

    const clientId = application(id).client_id as number;
    expect(() => conveyor.clientSign(id, clientId)).toThrow("Сначала скачайте документ");
    for (const document of generated) documents.markDocumentOpened(document.id, clientId);
    expect(() => conveyor.clientSign(id, clientId)).toThrow("Подтвердите ознакомление");
    expect(documents.acknowledgeDocumentPackage(id, clientId)).toBe(3);

    const eventsBeforeSigning = (database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(id) as { count: number }).count;
    conveyor.clientSign(id, clientId);
    const signedApplication = application(id);
    expect(signedApplication.status).toBe("READY_FOR_ISSUANCE");
    expect(signedApplication.signed_by).toBe(clientId);
    expect(typeof signedApplication.signed_at).toBe("string");
    expect((database.prepare("SELECT COUNT(*) AS count FROM documents WHERE application_id = ? AND status = 'SIGNED' AND signed_by = ?").get(id, clientId) as { count: number }).count).toBe(3);
    expect(database.prepare("SELECT from_status, to_status, actor, created_at FROM application_events WHERE application_id = ? ORDER BY id DESC LIMIT 1").get(id)).toEqual({
      from_status: "SIGNING",
      to_status: "READY_FOR_ISSUANCE",
      actor: "Клиент",
      created_at: signedApplication.signed_at,
    });

    conveyor.clientSign(id, clientId);
    expect(application(id).signed_at).toBe(signedApplication.signed_at);
    expect((database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(id) as { count: number }).count).toBe(eventsBeforeSigning + 1);

    const bankId = bankUserId(id);
    conveyor.issueApplication(id, bankId, "Тестовый аналитик");
    const issuedApplication = application(id);
    expect(issuedApplication.status).toBe("ISSUED");
    expect(issuedApplication.issued_by).toBe(bankId);
    expect(issuedApplication.issuance_mode).toBe("BANK_CONFIRMED");
    expect(typeof issuedApplication.issued_at).toBe("string");
    expect(Date.parse(issuedApplication.issued_at as string)).toBeGreaterThan(Date.parse(signedApplication.signed_at as string));
    expect(database.prepare("SELECT from_status, to_status, actor, created_at FROM application_events WHERE application_id = ? ORDER BY id DESC LIMIT 1").get(id)).toEqual({
      from_status: "READY_FOR_ISSUANCE",
      to_status: "ISSUED",
      actor: "Тестовый аналитик",
      created_at: issuedApplication.issued_at,
    });

    const eventsAfterIssuance = (database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(id) as { count: number }).count;
    conveyor.issueApplication(id, bankId, "Тестовый аналитик");
    expect(application(id).issued_at).toBe(issuedApplication.issued_at);
    expect((database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(id) as { count: number }).count).toBe(eventsAfterIssuance);
  });

  it("rejects acceptance after the offer validity period", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    approveByBank(id);
    const decision = JSON.parse(application(id).decision as string) as Record<string, unknown>;
    decision.validUntil = "2000-01-01T00:00:00.000Z";
    database.prepare("UPDATE applications SET decision = ? WHERE id = ?").run(JSON.stringify(decision), id);

    expect(() => conveyor.clientAcceptOffer(id)).toThrow("Срок действия предложения истёк");
    expect(application(id).status).toBe("OFFER");
    expect((database.prepare("SELECT COUNT(*) AS count FROM documents WHERE application_id = ?").get(id) as { count: number }).count).toBe(0);
  });

  it("rejects an incomplete offer without validUntil", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    approveByBank(id);
    const decision = JSON.parse(application(id).decision as string) as Record<string, unknown>;
    delete decision.validUntil;
    database.prepare("UPDATE applications SET decision = ? WHERE id = ?").run(JSON.stringify(decision), id);

    expect(() => conveyor.clientAcceptOffer(id)).toThrow("Не указан корректный срок действия предложения");
    expect(application(id).status).toBe("OFFER");
    expect((database.prepare("SELECT COUNT(*) AS count FROM documents WHERE application_id = ?").get(id) as { count: number }).count).toBe(0);
  });

  it("stores final economics and safe preliminary terms in the decision", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
      termMonths: 12,
    });
    const created = application(id);
    const calculationId = Number(database.prepare(`
      INSERT INTO calculator_runs (user_id, company_id, product_id, input_json, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      created.client_id,
      created.company_id,
      created.product_id,
      JSON.stringify({ product_id: created.product_id, amount: 1_000_000, term_months: 12, purpose_category: "оборотные средства" }),
      JSON.stringify({
        result: { current: { rate: 21.5, monthlyPayment: 93_000, overpayment: 116_000, totalPayment: 1_116_000, score: 105, internalGrade: "A" } },
        selection: { recommended: { product: { id: created.product_id, name: "Тестовый кредит" } } },
      }),
      new Date().toISOString(),
    ).lastInsertRowid);
    database.prepare("UPDATE applications SET source_calculation_id = ? WHERE id = ?").run(calculationId, id);

    conveyor.runConveyor(id);
    approveByBank(id);

    const decision = JSON.parse(application(id).decision as string) as Record<string, unknown>;
    expect(decision).toMatchObject({
      type: "APPROVE",
      monthlyPayment: annuityPayment(1_000_000, 20, 12),
      overpayment: annuityOverpayment(1_000_000, 20, 12),
      paymentType: "ANNUITY",
      feesIncluded: false,
      preliminaryTerms: {
        productName: "Тестовый кредит",
        amount: 1_000_000,
        termMonths: 12,
        rate: 21.5,
        monthlyPayment: 93_000,
        overpayment: 116_000,
        totalPayment: 1_116_000,
      },
    });
    expect(decision.totalPayment).toBe(1_000_000 + (decision.overpayment as number));
    expect(Date.parse(decision.validUntil as string) - Date.parse(decision.decidedAt as string)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(decision.preliminaryTerms).not.toHaveProperty("score");
    expect(decision.preliminaryTerms).not.toHaveProperty("internalGrade");
  });

  it("recalculates and stores risk for final changed terms without rewriting the original score", () => {
    const id = createApplication({
      autoGrades: ["A"], regDate: "2010-01-01", revenue: 60_000_000, profit: 8_000_000,
      obligations: 100_000, bkiScore: 800, overdueCount: 0, worstDelayDays: 0,
      monthlyPayment: 50_000, amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    const before = application(id);
    const product = database.prepare("SELECT id, name, rate_from FROM products WHERE id = ?").get(before.product_id) as { id: number; name: string; rate_from: number };

    conveyor.applyDecision(id, {
      type: "CONDITIONS",
      rate: product.rate_from + 3,
      amount: 100_000_000,
      termMonths: before.term_months as number,
      reason: "Сотрудник банка предлагает увеличенную сумму после отдельной проверки финальных условий.",
      productId: product.id,
      productName: product.name,
    }, "Тестовый аналитик", bankUserId(id));

    const after = application(id);
    const decision = JSON.parse(after.decision as string) as {
      finalRiskAssessment: { assessedAmount: number; productId: number; score: number; factors: Array<{ key: string; points: number }> };
    };
    expect(after.score).toBe(before.score);
    expect(decision.finalRiskAssessment).toMatchObject({ assessedAmount: 100_000_000, productId: product.id });
    expect(decision.finalRiskAssessment.factors.find((factor) => factor.key === "amount_ratio")?.points).toBe(-10);
    expect(decision.finalRiskAssessment.score).toBeLessThan(before.score as number);
  });

  it("rejects an ineligible bank product even when the domain function is called directly", () => {
    const id = createApplication({
      autoGrades: ["A"], regDate: "2010-01-01", revenue: 6_500_000, profit: 800_000,
      obligations: 100_000, bkiScore: 800, overdueCount: 0, worstDelayDays: 0,
      monthlyPayment: 50_000, amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    const row = application(id);
    database.prepare("UPDATE products SET min_revenue = 10000000, purpose_tags = 'оборудование' WHERE id = ?").run(row.product_id);

    expect(() => conveyor.applyDecision(id, {
      type: "APPROVE",
      rate: 20,
      amount: row.amount as number,
      termMonths: row.term_months as number,
      reason: "Попытка обойти ограничения продукта прямым доменным вызовом.",
      productId: row.product_id as number,
      productName: "Тестовый кредит",
    }, "Тестовый аналитик", bankUserId(id))).toThrow("Годовая выручка ниже минимальной");
    expect(application(id).status).toBe("DECISION");
    expect(application(id).decision).toBeNull();
  });

  it("upserts requested financials and reruns the conveyor atomically", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
    });
    const created = application(id);
    database.prepare("DELETE FROM financial_reports WHERE company_id = ?").run(created.company_id);
    database.prepare("DELETE FROM financials WHERE company_id = ?").run(created.company_id);
    conveyor.runConveyor(id);
    expect(application(id).status).toBe("MORE_INFO");
    expect(database.prepare("SELECT request_type, status, required_fields_json FROM more_info_requests WHERE application_id = ?").get(id)).toEqual({
      request_type: "FINANCIALS",
      status: "WAITING_CLIENT",
      required_fields_json: JSON.stringify(["year", "revenue", "profit", "own_capital", "monthly_obligations"]),
    });

    expect(() => conveyor.upsertFinancialsAndRespond(id, created.client_id as number, {
      year: 2100,
      revenue: 999_000_000,
      profit: 100_000_000,
      ownCapital: 200_000_000,
      monthlyObligations: 1,
    })).toThrow("Допустимы отчётные периоды");
    expect(application(id).status).toBe("MORE_INFO");

    conveyor.upsertFinancialsAndRespond(id, created.client_id as number, {
      year: 2026,
      revenue: 65_000_000,
      profit: 9_000_000,
      ownCapital: 15_000_000,
      monthlyObligations: 90_000,
      comment: "Отчётность загружена",
    });

    expect(application(id).status).toBe("DECISION");
    expect(application(id).decision).toBeNull();
    expect(database.prepare("SELECT revenue, profit, own_capital, monthly_obligations, status, source FROM financial_reports WHERE company_id = ? AND reporting_year = 2026").get(created.company_id))
      .toEqual({ revenue: 65_000_000, profit: 9_000_000, own_capital: 15_000_000, monthly_obligations: 90_000, status: "SUBMITTED", source: "CLIENT" });
    expect(database.prepare("SELECT status, responded_at, closed_at FROM more_info_requests WHERE application_id = ?").get(id)).toMatchObject({ status: "CLOSED" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM more_info_responses WHERE application_id = ?").get(id) as { count: number }).count).toBe(1);

    expect(() => approveByBank(id)).toThrow("финансовая отчётность ещё не подтверждена");
    const report = database.prepare("SELECT id FROM financial_reports WHERE company_id = ? AND reporting_year = 2026").get(created.company_id) as { id: number };
    conveyor.reviewFinancialReport(id, report.id, "VERIFY", created.client_id as number, "Тестовый аналитик");
    expect(database.prepare("SELECT status, verified_by FROM financial_reports WHERE id = ?").get(report.id))
      .toEqual({ status: "VERIFIED", verified_by: created.client_id });
    approveByBank(id);
    const decision = JSON.parse(application(id).decision as string) as Record<string, unknown>;
    expect(decision.financialReportSnapshot).toMatchObject({ id: report.id, status: "VERIFIED", source: "CLIENT" });
  });

  it("stores a typed bank request, archives the recommendation, and rechecks after the matching response", () => {
    const id = createApplication({
      autoGrades: ["A"], regDate: "2010-01-01", revenue: 60_000_000, profit: 8_000_000,
      obligations: 100_000, bkiScore: 800, overdueCount: 0, worstDelayDays: 0,
      monthlyPayment: 50_000, amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    const beforeRecommendation = database.prepare("SELECT id FROM recommendation_snapshots WHERE application_id = ? ORDER BY id DESC LIMIT 1").get(id) as { id: number };

    conveyor.applyDecision(id, {
      type: "MORE_INFO", rate: null, amount: null, termMonths: null,
      reason: "Предоставьте договор аренды и выписку",
    }, "Тестовый аналитик", 999, {
      type: "DOCUMENT",
      reason: "Предоставьте договор аренды и выписку",
      requiredFiles: ["Договор аренды", "Выписка"],
      dueAt: "2026-11-01T00:00:00.000Z",
    });

    expect(application(id)).toMatchObject({ status: "MORE_INFO", decision: null, decided_by: null, decided_at: null });
    const request = database.prepare("SELECT id, request_type, status, required_files_json FROM more_info_requests WHERE application_id = ?").get(id) as Record<string, unknown>;
    expect(request).toMatchObject({ request_type: "DOCUMENT", status: "WAITING_CLIENT", required_files_json: JSON.stringify(["Договор аренды", "Выписка"]) });
    expect(database.prepare("SELECT superseded_at, superseded_by_request_id FROM recommendation_snapshots WHERE id = ?").get(beforeRecommendation.id)).toMatchObject({ superseded_by_request_id: request.id });
    expect(() => conveyor.clientSubmitMoreInfoResponse(id, application(id).client_id as number, request.id as number, {
      files: [{ name: "only-one.pdf", size: 100, type: "application/pdf" }],
    })).toThrow("не все обязательные файлы");
    expect(application(id).status).toBe("MORE_INFO");

    conveyor.clientSubmitMoreInfoResponse(id, application(id).client_id as number, request.id as number, {
      files: [
        { name: "rent.pdf", size: 100, type: "application/pdf" },
        { name: "statement.pdf", size: 200, type: "application/pdf" },
      ],
    });

    expect(application(id).status).toBe("DECISION");
    expect(database.prepare("SELECT status FROM more_info_requests WHERE id = ?").get(request.id)).toEqual({ status: "CLOSED" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM recommendation_snapshots WHERE application_id = ?").get(id) as { count: number }).count).toBe(2);
    expect((database.prepare("SELECT COUNT(*) AS count FROM more_info_responses WHERE request_id = ?").get(request.id) as { count: number }).count).toBe(1);
  });

  it("keeps external-system retries on the bank side", () => {
    const id = createApplication({
      autoGrades: ["A"], regDate: "2010-01-01", revenue: 60_000_000, profit: 8_000_000,
      obligations: 100_000, bkiScore: 800, overdueCount: 0, worstDelayDays: 0,
      monthlyPayment: 50_000, amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    conveyor.applyDecision(id, {
      type: "MORE_INFO", rate: null, amount: null, termMonths: null,
      reason: "Повторить запрос БКИ",
    }, "Тестовый аналитик", 999, { type: "SYSTEM_RETRY", reason: "Повторить запрос БКИ" });
    const request = database.prepare("SELECT id, request_type, status FROM more_info_requests WHERE application_id = ?").get(id) as { id: number; request_type: string; status: string };
    expect(request).toMatchObject({ request_type: "SYSTEM_RETRY", status: "RECHECK" });
    expect(() => conveyor.clientSubmitMoreInfoResponse(id, application(id).client_id as number, request.id, { comment: "готово" }))
      .toThrow("не ожидает действия клиента");

    conveyor.retrySystemMoreInfo(id, 999, "Тестовый аналитик");

    expect(application(id).status).toBe("DECISION");
    expect(database.prepare("SELECT status FROM more_info_requests WHERE id = ?").get(request.id)).toEqual({ status: "CLOSED" });
    expect(database.prepare("SELECT source FROM more_info_responses WHERE request_id = ?").get(request.id)).toEqual({ source: "BANK" });
  });

  it("rolls back financials when the repeated conveyor transition fails", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
    });
    const created = application(id);
    database.prepare("DELETE FROM financial_reports WHERE company_id = ?").run(created.company_id);
    database.prepare("DELETE FROM financials WHERE company_id = ?").run(created.company_id);
    conveyor.runConveyor(id);
    database.exec(`
      CREATE TRIGGER fail_more_info_response
      BEFORE INSERT ON application_events
      WHEN NEW.from_status = 'MORE_INFO' AND NEW.to_status = 'SUBMITTED'
      BEGIN
        SELECT RAISE(ABORT, 'response transition failed');
      END;
    `);

    expect(() => conveyor.upsertFinancialsAndRespond(id, created.client_id as number, {
      year: 2026,
      revenue: 65_000_000,
      profit: 9_000_000,
      ownCapital: 15_000_000,
      monthlyObligations: 90_000,
    })).toThrow("response transition failed");
    expect(application(id).status).toBe("MORE_INFO");
    expect((database.prepare("SELECT COUNT(*) AS count FROM financial_reports WHERE company_id = ?").get(created.company_id) as { count: number }).count).toBe(0);
    database.exec("DROP TRIGGER fail_more_info_response");
  });

  it("backfills a missing legacy recommendation without changing the saved score", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    const original = application(id);
    database.prepare("DELETE FROM recommendation_snapshots WHERE application_id = ?").run(id);

    expect(conveyor.backfillRecommendationSnapshots()).toBe(1);
    expect(conveyor.getStoredRecommendation(id)).toMatchObject({
      applicationId: id,
      score: original.score,
      grade: original.grade,
    });
    expect(application(id)).toEqual(original);
    expect(conveyor.backfillRecommendationSnapshots()).toBe(0);
  });

  it("rolls back offer acceptance if document generation fails", () => {
    const id = createApplication({
      autoGrades: ["A"],
      regDate: "2010-01-01",
      revenue: 60_000_000,
      profit: 8_000_000,
      obligations: 100_000,
      bkiScore: 800,
      overdueCount: 0,
      worstDelayDays: 0,
      monthlyPayment: 50_000,
      amount: 1_000_000,
    });
    conveyor.runConveyor(id);
    approveByBank(id);
    database.exec(`
      CREATE TRIGGER fail_payment_schedule
      BEFORE INSERT ON documents
      WHEN NEW.kind = 'График платежей'
      BEGIN
        SELECT RAISE(ABORT, 'document generation failed');
      END;
    `);

    expect(() => conveyor.clientAcceptOffer(id)).toThrow("document generation failed");
    expect(application(id).status).toBe("OFFER");
    expect((database.prepare("SELECT COUNT(*) AS count FROM documents WHERE application_id = ?").get(id) as { count: number }).count).toBe(0);
    database.exec("DROP TRIGGER fail_payment_schedule");
  });
});
