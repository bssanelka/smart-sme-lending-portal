import { db, now } from "./db";
import {
  buildDecisionEconomics,
  preliminaryTermsFromSnapshot,
  requireDecisionEconomicsSnapshot,
  type PreliminaryTerms,
} from "./calculator";
import {
  proposeDecisionFromGrade,
  scoreApplication,
  type DecisionProposal,
  type ScoreFactor,
  type ScoringInput,
} from "./scoring";
import {
  captureExternalCheckSnapshots,
  latestExternalCheck,
  type BusinessRegistrySnapshot,
  type CreditHistorySnapshot,
} from "./external-providers";
import {
  cancelActiveMoreInfoRequests,
  closeMoreInfoRequest,
  createMoreInfoRequest,
  getActiveMoreInfoRequest,
  markMoreInfoRecheck,
  saveMoreInfoResponse,
  type MoreInfoRequestInput,
} from "./more-info";
import {
  financialReportForScoring,
  getFinancialReport,
  rejectFinancialReport,
  submitClientFinancialReport,
  verifyFinancialReport,
  type FinancialReportInput,
  type FinancialReportSnapshot,
} from "./financial-reports";
import { assertSignedDocumentPackage, generateAndStoreDocumentPackage, signAcknowledgedDocumentPackage } from "./documents";
import { assertProductEligibility, productFromRecord } from "./product-eligibility";

// ---------------------------------------------------------------------------
// Модель состояний заявки (диаграмма состояний — в docs/ARCHITECTURE.md)
// SUBMITTED → DATA_CHECK → ENRICHMENT → SCORING → DECISION → OFFER → DOCUMENTS → SIGNING → READY_FOR_ISSUANCE → ISSUED
//                    ↘ MORE_INFO (запрошено уточнение, клиент отвечает → снова SUBMITTED)
// DECISION → REJECTED | DECLINED_BY_CLIENT (терминальные)
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Заявка принята",
  DATA_CHECK: "Проверка полноты данных",
  ENRICHMENT: "Получение данных из внешних источников",
  SCORING: "Скоринговая оценка",
  DECISION: "Предварительная оценка готова",
  MORE_INFO: "Запрошено уточнение",
  OFFER: "Решение банка — предложение условий",
  REJECTED: "Отказ",
  DECLINED_BY_CLIENT: "Клиент отказался от предложения",
  DOCUMENTS: "Оформление документов",
  SIGNING: "Подписание документов",
  READY_FOR_ISSUANCE: "Документы подписаны — ожидается выдача",
  ISSUED: "Средства выданы",
};

export const TERMINAL_STATUSES = ["REJECTED", "DECLINED_BY_CLIENT", "ISSUED"];
export const CLIENT_VISIBLE_FLOW = ["SUBMITTED", "DATA_CHECK", "ENRICHMENT", "SCORING", "DECISION", "MORE_INFO", "OFFER", "DOCUMENTS", "SIGNING", "READY_FOR_ISSUANCE", "ISSUED", "REJECTED", "DECLINED_BY_CLIENT"];

type Row = Record<string, unknown>;

type RiskGrade = "A" | "B" | "C" | "D";
type MoreInfoDecisionProposal = DecisionProposal & {
  type: "MORE_INFO";
  internalReason?: never;
  clientComment?: never;
};

type FinalBankDecisionProposal = DecisionProposal & {
  type: "APPROVE" | "CONDITIONS" | "REJECT";
  internalReason: string;
  clientComment: string;
};

type BankDecisionProposal = MoreInfoDecisionProposal | FinalBankDecisionProposal;

export interface RecommendationSnapshot {
  id: number;
  applicationId: number;
  scorecardVersion: string;
  score: number;
  grade: RiskGrade;
  factors: ScoreFactor[];
  proposal: DecisionProposal;
  calculatedAt: string;
  supersededAt: string | null;
  supersededByRequestId: number | null;
  financialReport: FinancialReportSnapshot | null;
}

export function getApplication(id: number): Row | undefined {
  return db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as Row | undefined;
}

export function addEvent(applicationId: number, from: string | null, to: string, actor: string, comment?: string) {
  db.prepare("INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at) VALUES (?,?,?,?,?,?)")
    .run(applicationId, from, to, actor, comment ?? null, now());
}

function setStatus(app: Row, to: string, actor: string, comment?: string, timestamp = now()): Row {
  db.prepare("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?").run(to, timestamp, app.id as number);
  db.prepare("INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at) VALUES (?,?,?,?,?,?)")
    .run(app.id as number, app.status as string, to, actor, comment ?? null, timestamp);
  return { ...app, status: to, updated_at: timestamp };
}

export function buildScoringInput(app: Row): ScoringInput {
  const applicationId = app.id as number;
  const companyId = app.company_id as number;
  const registryCheck = latestExternalCheck<BusinessRegistrySnapshot>(applicationId, "BUSINESS_REGISTRY");
  const company = registryCheck?.status === "SUCCESS" && registryCheck.payload
    ? registryCheck.payload as unknown as Row
    : db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as Row;
  const fin = financialReportForScoring(companyId, Number.isInteger(applicationId) ? applicationId : undefined);
  const bkiCheck = latestExternalCheck<CreditHistorySnapshot>(applicationId, "BKI");
  const bki = bkiCheck
    ? (bkiCheck.status === "SUCCESS" && bkiCheck.payload ? bkiCheck.payload as unknown as Row : undefined)
    : db.prepare("SELECT * FROM credit_history WHERE company_id = ? ORDER BY updated_at DESC LIMIT 1").get(companyId) as Row | undefined;
  const ageYears = (Date.now() - new Date(company.reg_date as string).getTime()) / (365.25 * 24 * 3600 * 1000);
  const revenue = fin?.revenue ?? 0;
  const monthlyIncome = revenue / 12;
  const monthlyDebts = (bki ? (bki.monthly_payment as number) : 0) + (fin?.monthlyObligations ?? 0);
  return {
    companyAgeYears: Math.max(0, ageYears),
    revenueAnnual: revenue,
    profitAnnual: fin?.profit ?? 0,
    bkiScore: bki ? (bki.bki_score as number) : 550,
    overdueCount: bki ? (bki.overdue_count as number) : 0,
    worstDelayDays: bki ? (bki.worst_delay_days as number) : 0,
    pdn: monthlyIncome > 0 ? (monthlyDebts / monthlyIncome) * 100 : 100,
    amountToRevenueRatio: revenue > 0 ? (app.amount as number) / revenue : 10,
    hasFinancials: !!fin,
  };
}

function insertRecommendationSnapshot(
  applicationId: number,
  scorecardVersion: string,
  score: number,
  grade: RiskGrade,
  factors: ScoreFactor[],
  proposal: DecisionProposal,
  calculatedAt: string,
  financialReport: FinancialReportSnapshot | null,
): RecommendationSnapshot {
  const id = Number(db.prepare(`
    INSERT INTO recommendation_snapshots (
      application_id, scorecard_version, score, grade, factors_json, proposal_json,
      calculated_at, financial_report_snapshot_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    applicationId,
    scorecardVersion,
    score,
    grade,
    JSON.stringify(factors),
    JSON.stringify(proposal),
    calculatedAt,
    financialReport ? JSON.stringify(financialReport) : null,
  ).lastInsertRowid);
  return { id, applicationId, scorecardVersion, score, grade, factors, proposal, calculatedAt, supersededAt: null, supersededByRequestId: null, financialReport };
}

export function getStoredRecommendation(applicationId: number): RecommendationSnapshot | null {
  const row = db.prepare(`
    SELECT id, application_id, scorecard_version, score, grade, factors_json, proposal_json, calculated_at,
      superseded_at, superseded_by_request_id, financial_report_snapshot_json
    FROM recommendation_snapshots
    WHERE application_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(applicationId) as Row | undefined;
  if (!row) return null;
  try {
    return {
      id: row.id as number,
      applicationId: row.application_id as number,
      scorecardVersion: row.scorecard_version as string,
      score: row.score as number,
      grade: row.grade as RiskGrade,
      factors: JSON.parse(row.factors_json as string) as ScoreFactor[],
      proposal: JSON.parse(row.proposal_json as string) as DecisionProposal,
      calculatedAt: row.calculated_at as string,
      supersededAt: row.superseded_at as string | null,
      supersededByRequestId: row.superseded_by_request_id as number | null,
      financialReport: typeof row.financial_report_snapshot_json === "string"
        ? JSON.parse(row.financial_report_snapshot_json) as FinancialReportSnapshot
        : null,
    };
  } catch {
    return null;
  }
}

export function runScoring(app: Row) {
  const input = buildScoringInput(app);
  const result = scoreApplication(input);
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(app.product_id as number) as Row | undefined;
  if (!product) throw new Error("Продукт заявки не найден");
  const proposal = {
    ...proposeDecisionFromGrade(result.grade, input, product.rate_from as number, app.amount as number, app.term_months as number, {
      minAmount: product.min_amount as number,
      maxAmount: product.max_amount as number,
      termMin: product.term_min as number,
      termMax: product.term_max as number,
    }),
    productId: product.id as number,
    productName: product.name as string,
  };
  const calculatedAt = now();
  db.prepare("UPDATE applications SET score = ?, grade = ?, score_details = ?, scorecard_version = ? WHERE id = ?")
    .run(result.score, result.grade, JSON.stringify(result.factors), result.scorecardVersion, app.id as number);
  const recommendation = insertRecommendationSnapshot(
    app.id as number,
    result.scorecardVersion,
    result.score,
    result.grade,
    result.factors,
    proposal,
    calculatedAt,
    financialReportForScoring(app.company_id as number, app.id as number),
  );
  return { ...result, proposal: recommendation.proposal, calculatedAt };
}

export function backfillRecommendationSnapshots(): number {
  const rows = db.prepare(`
    SELECT *
    FROM applications a
    WHERE a.score IS NOT NULL
      AND a.grade IN ('A','B','C','D')
      AND a.score_details IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_snapshots r WHERE r.application_id = a.id
      )
    ORDER BY a.id
  `).all() as Row[];
  let inserted = 0;
  const backfill = db.transaction(() => {
    for (const app of rows) {
      let factors: ScoreFactor[];
      try {
        factors = JSON.parse(app.score_details as string) as ScoreFactor[];
      } catch {
        continue;
      }
      const input = buildScoringInput(app);
      const product = db.prepare("SELECT * FROM products WHERE id = ?").get(app.product_id as number) as Row | undefined;
      if (!product) continue;
      const proposal = {
        ...proposeDecisionFromGrade(app.grade as RiskGrade, input, product.rate_from as number, app.amount as number, app.term_months as number, {
          minAmount: product.min_amount as number,
          maxAmount: product.max_amount as number,
          termMin: product.term_min as number,
          termMax: product.term_max as number,
        }),
        productId: product.id as number,
        productName: product.name as string,
      };
      const scoringEvent = db.prepare(`
        SELECT created_at FROM application_events
        WHERE application_id = ? AND to_status = 'SCORING'
        ORDER BY id DESC LIMIT 1
      `).get(app.id as number) as { created_at: string } | undefined;
      insertRecommendationSnapshot(
        app.id as number,
        typeof app.scorecard_version === "string" ? app.scorecard_version : "legacy-unversioned",
        app.score as number,
        app.grade as RiskGrade,
        factors,
        proposal,
        scoringEvent?.created_at ?? app.updated_at as string,
        financialReportForScoring(app.company_id as number, app.id as number),
      );
      inserted += 1;
    }
  });
  backfill();
  return inserted;
}

// Сквозной конвейер: автоматические этапы от приёма до предварительной рекомендации сотруднику банка
const runConveyorTransaction = db.transaction((applicationId: number) => {
  let app = getApplication(applicationId);
  if (!app) throw new Error("Заявка не найдена");
  if (app.status !== "SUBMITTED" && app.status !== "DATA_CHECK") return;
  const recheckRequest = getActiveMoreInfoRequest(applicationId);

  app = setStatus(app, "DATA_CHECK", "Система", "Проверка полноты и корректности введённых данных");
  const input = buildScoringInput(app);
  if (!input.hasFinancials) {
    createMoreInfoRequest(applicationId, {
      type: "FINANCIALS",
      reason: "Требуется финансовая отчётность за последний завершённый год",
      requiredFields: ["year", "revenue", "profit", "own_capital", "monthly_obligations"],
    }, "SYSTEM", null);
    setStatus(app, "MORE_INFO", "Система", "Ожидается финансовая отчётность клиента (WAITING_CLIENT)");
    return;
  }

  app = setStatus(app, "ENRICHMENT", "Система", "Запрос данных БКИ и реестров ЕГРЮЛ/ЕГРИП (локальные providers)");
  const checks = captureExternalCheckSnapshots(app.id as number, app.company_id as number);
  if (checks.registry.status !== "SUCCESS") {
    createMoreInfoRequest(applicationId, {
      type: "SYSTEM_RETRY",
      reason: "Банк не получил подтверждение компании из ЕГРЮЛ/ЕГРИП и должен повторить системную проверку",
    }, "SYSTEM", null);
    setStatus(app, "MORE_INFO", "Система", "Внешний реестр недоступен; действие клиента не требуется, проверку повторит банк");
    return;
  }
  if (checks.bki.status !== "SUCCESS") {
    createMoreInfoRequest(applicationId, {
      type: "SYSTEM_RETRY",
      reason: "Банк не получил ответ БКИ и должен повторить системную проверку",
    }, "SYSTEM", null);
    setStatus(app, "MORE_INFO", "Система", "БКИ недоступно; действие клиента не требуется, проверку повторит банк");
    return;
  }

  app = setStatus(app, "SCORING", "Система", "Расчёт скоринговой оценки по сохранённым snapshots внешних проверок");
  const result = runScoring(app);

  setStatus(app, "DECISION", "Система", `Автоматическая оценка завершена по методологии ${result.scorecardVersion}: ${result.score} баллов, класс ${result.grade}. Рекомендация передана сотруднику банка для финального решения.`);
  if (recheckRequest?.status === "RECHECK") closeMoreInfoRequest(recheckRequest.id);
});

export function runConveyor(applicationId: number) {
  return runConveyorTransaction(applicationId);
}

function preliminaryTermsFor(app: Row): PreliminaryTerms | null {
  if (typeof app.source_calculation_id !== "number") return null;
  const calculation = db.prepare(`SELECT user_id, company_id, product_id, input_json, result_json
    FROM calculator_runs WHERE id = ?`).get(app.source_calculation_id) as Row | undefined;
  if (!calculation || calculation.user_id !== app.client_id || calculation.company_id !== app.company_id) {
    throw new Error("Исходный расчёт заявки не найден");
  }
  return preliminaryTermsFromSnapshot({
    inputJson: calculation.input_json as string,
    resultJson: calculation.result_json as string,
    productId: calculation.product_id as number,
  });
}

const applyDecisionTransaction = db.transaction((
  applicationId: number,
  proposal: BankDecisionProposal,
  actor: string,
  decidedBy: number | null,
  moreInfoRequest?: MoreInfoRequestInput,
) => {
  const app = getApplication(applicationId);
  if (!app) throw new Error("Заявка не найдена");
  const decidedAt = now();

  if (proposal.type === "MORE_INFO") {
    if (!moreInfoRequest) throw new Error("Укажите тип и состав запроса дополнительной информации");
    createMoreInfoRequest(applicationId, { ...moreInfoRequest, reason: proposal.reason }, "BANK", decidedBy);
    db.prepare("UPDATE applications SET decision = NULL, decided_by = NULL, decided_at = NULL, updated_at = ? WHERE id = ?")
      .run(decidedAt, applicationId);
    const requestStatus = moreInfoRequest.type === "SYSTEM_RETRY" ? "RECHECK" : "WAITING_CLIENT";
    setStatus(app, "MORE_INFO", actor, `${proposal.reason} (${moreInfoRequest.type}, ${requestStatus})`);
    return;
  }

  cancelActiveMoreInfoRequests(applicationId);
  const preliminaryTerms = preliminaryTermsFor(app);
  const isOffer = proposal.type === "APPROVE" || proposal.type === "CONDITIONS";
  const financialReport = financialReportForScoring(app.company_id as number, applicationId);
  if (isOffer && (proposal.rate === null || proposal.amount === null || proposal.termMonths === null)) {
    throw new Error("Для одобрения обязательны ставка, сумма и срок");
  }
  if (isOffer && financialReport?.status !== "VERIFIED") {
    throw new Error("Положительное решение недоступно: финансовая отчётность ещё не подтверждена сотрудником банка");
  }
  const selectedProduct = isOffer
    ? db.prepare("SELECT * FROM products WHERE id = ?").get(proposal.productId ?? app.product_id) as Row | undefined
    : undefined;
  if (isOffer && !selectedProduct) throw new Error("Предлагаемый продукт не найден");

  let finalRiskAssessment;
  let canonicalProposal = proposal;
  if (isOffer && selectedProduct && financialReport) {
    assertProductEligibility(productFromRecord(selectedProduct), {
      amount: proposal.amount!,
      termMonths: proposal.termMonths!,
      purposeCategory: app.purpose_category as string,
      annualRevenue: financialReport.revenue,
    });
    const finalRisk = scoreApplication(buildScoringInput({ ...app, amount: proposal.amount! }));
    finalRiskAssessment = {
      scorecardVersion: finalRisk.scorecardVersion,
      score: finalRisk.score,
      grade: finalRisk.grade,
      factors: finalRisk.factors,
      assessedAmount: proposal.amount!,
      productId: selectedProduct.id as number,
      productName: selectedProduct.name as string,
      calculatedAt: decidedAt,
    };
    canonicalProposal = {
      ...proposal,
      productId: selectedProduct.id as number,
      productName: selectedProduct.name as string,
    };
  }
  const clientComment = proposal.clientComment;
  const decisionPayload = {
    ...canonicalProposal,
    reason: clientComment,
    clientComment,
    decidedAt,
    ...(preliminaryTerms ? { preliminaryTerms } : {}),
    ...(isOffer && financialReport ? { financialReportSnapshot: financialReport } : {}),
    ...(finalRiskAssessment ? { finalRiskAssessment } : {}),
  };
  const decision = JSON.stringify(isOffer
    ? { ...decisionPayload, ...buildDecisionEconomics(proposal.amount!, proposal.rate!, proposal.termMonths!, decidedAt) }
    : decisionPayload);

  db.prepare("UPDATE applications SET decision = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .run(decision, decidedBy, decidedAt, decidedAt, applicationId);
  if (isOffer) {
    setStatus(app, "OFFER", actor, clientComment);
  } else {
    setStatus(app, "REJECTED", actor, clientComment);
  }
});

export function applyDecision(
  applicationId: number,
  proposal: BankDecisionProposal,
  actor: string,
  decidedBy: number,
  moreInfoRequest?: MoreInfoRequestInput,
) {
  return applyDecisionTransaction(applicationId, proposal, actor, decidedBy, moreInfoRequest);
}

// Действия клиента после одобрения (моделируются без реальных операций — п. 06 допущений кейса)
export class OfferExpiredError extends Error {
  override name = "OfferExpiredError";
}

export class OfferDataError extends Error {
  override name = "OfferDataError";
}

function assertOfferIsActive(rawDecision: unknown, acceptedAt = Date.now()) {
  if (typeof rawDecision !== "string" || rawDecision.length === 0) {
    throw new OfferDataError("Финансовые условия предложения отсутствуют. Обратитесь в банк за новым решением.");
  }

  let decision: unknown;
  try {
    decision = JSON.parse(rawDecision);
  } catch {
    throw new OfferDataError("Финансовые условия предложения повреждены. Обратитесь в банк за новым решением.");
  }

  let economics;
  try {
    economics = requireDecisionEconomicsSnapshot(decision);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "неполный snapshot";
    throw new OfferDataError(`Нельзя принять предложение: ${detail}. Обратитесь в банк за новым решением.`);
  }

  const expiresAt = Date.parse(economics.validUntil);
  if (acceptedAt >= expiresAt) {
    throw new OfferExpiredError("Срок действия предложения истёк. Обратитесь в банк за новым решением.");
  }
}

const clientAcceptOfferTransaction = db.transaction((applicationId: number) => {
  let app = getApplication(applicationId);
  if (!app || app.status !== "OFFER") throw new Error("Нет активного предложения");
  assertOfferIsActive(app.decision);
  app = setStatus(app, "DOCUMENTS", "Клиент", "Клиент принял предложение, формируется пакет документов");
  generateAndStoreDocumentPackage(applicationId);
  setStatus(app, "SIGNING", "Система", "Версионированный пакет документов сформирован и готов к ознакомлению");
});

export function clientAcceptOffer(applicationId: number) {
  return clientAcceptOfferTransaction(applicationId);
}

const clientSignTransaction = db.transaction((applicationId: number, clientId: number) => {
  const app = getApplication(applicationId);
  if (!app) throw new Error("Заявка не найдена");
  if (app.client_id !== clientId) throw new Error("Нет доступа к подписанию заявки");
  if (app.status === "READY_FOR_ISSUANCE" || app.status === "ISSUED") {
    if (app.signed_by === clientId && typeof app.signed_at === "string") return app;
    throw new Error("Состояние подписания заявки повреждено");
  }
  if (app.status !== "SIGNING") throw new Error("Документы не готовы к подписанию");
  signAcknowledgedDocumentPackage(applicationId, clientId);
  const signedAt = now();
  db.prepare("UPDATE applications SET signed_at = ?, signed_by = ? WHERE id = ?")
    .run(signedAt, clientId, applicationId);
  return setStatus(app, "READY_FOR_ISSUANCE", "Клиент", "Полный пакет документов модельно подписан и передан банку для отдельного подтверждения выдачи", signedAt);
});

export function clientSign(applicationId: number, clientId: number) {
  return clientSignTransaction(applicationId, clientId);
}

const issueApplicationTransaction = db.transaction((applicationId: number, bankUserId: number, actor: string) => {
  const app = getApplication(applicationId);
  if (!app) throw new Error("Заявка не найдена");
  if (app.status === "ISSUED") {
    if (typeof app.issued_at === "string") return app;
    throw new Error("Состояние выдачи заявки повреждено");
  }
  if (app.status !== "READY_FOR_ISSUANCE") throw new Error("Заявка ещё не готова к выдаче");
  if (typeof app.signed_at !== "string" || typeof app.signed_by !== "number") {
    throw new Error("Не зафиксировано подписание клиента");
  }
  assertSignedDocumentPackage(applicationId);
  const issuedAtCandidate = now();
  const signedAtMs = Date.parse(app.signed_at as string);
  const issuedAt = Number.isFinite(signedAtMs) && Date.parse(issuedAtCandidate) <= signedAtMs
    ? new Date(signedAtMs + 1).toISOString()
    : issuedAtCandidate;
  db.prepare("UPDATE applications SET issued_at = ?, issued_by = ?, issuance_mode = 'BANK_CONFIRMED' WHERE id = ?")
    .run(issuedAt, bankUserId, applicationId);
  return setStatus(app, "ISSUED", actor, "Сотрудник банка подтвердил модельную выдачу. Реальная проводка и движение денег не выполнялись", issuedAt);
});

export function issueApplication(applicationId: number, bankUserId: number, actor: string) {
  return issueApplicationTransaction(applicationId, bankUserId, actor);
}

const clientDeclineTransaction = db.transaction((applicationId: number) => {
  const app = getApplication(applicationId);
  if (!app || app.status !== "OFFER") throw new Error("Нет активного предложения");
  setStatus(app, "DECLINED_BY_CLIENT", "Клиент", "Клиент отказался от предложенных условий");
});

export function clientDecline(applicationId: number) {
  return clientDeclineTransaction(applicationId);
}


export interface MoreInfoClientResponseInput {
  comment?: string;
  financials?: FinancialReportInput;
  files?: Array<{ name: string; size: number; type: string }>;
  consent?: boolean;
  companyData?: Record<string, string>;
}


function resumeAfterMoreInfoResponse(applicationId: number, requestId: number, actor: string, summary: string) {
  const timestamp = now();
  db.prepare("UPDATE applications SET client_comment = ?, decision = NULL, decided_by = NULL, decided_at = NULL, status = 'SUBMITTED', updated_at = ? WHERE id = ?")
    .run(summary, timestamp, applicationId);
  addEvent(applicationId, "MORE_INFO", "MORE_INFO", actor, `Ответ сохранён (CLIENT_RESPONDED): ${summary}`);
  markMoreInfoRecheck(requestId);
  addEvent(applicationId, "MORE_INFO", "SUBMITTED", "Система", "Обязательный запрос закрыт, запущена повторная проверка (RECHECK)");
  runConveyor(applicationId);
  closeMoreInfoRequest(requestId);
}

const clientSubmitMoreInfoResponseTransaction = db.transaction((
  applicationId: number,
  clientId: number,
  requestId: number,
  input: MoreInfoClientResponseInput,
) => {
  const app = getApplication(applicationId);
  if (!app || app.client_id !== clientId) throw new Error("Нет доступа к заявке");
  if (app.status !== "MORE_INFO") throw new Error("В заявке нет активного запроса дополнительной информации");
  const request = getActiveMoreInfoRequest(applicationId);
  if (!request || request.id !== requestId) throw new Error("Запрос уже закрыт или заменён новым");
  if (request.status !== "WAITING_CLIENT") throw new Error("Этот запрос не ожидает действия клиента");

  let payload: Record<string, unknown>;
  let summary: string;
  if (request.type === "FINANCIALS") {
    if (!input.financials) throw new Error("Передайте обязательные финансовые показатели");
    const report = submitClientFinancialReport(app.company_id as number, applicationId, clientId, input.financials);
    payload = { financials: input.financials, reportId: report.id, reportStatus: report.status, source: report.source };
    summary = input.financials.comment?.trim() || `Финансовая отчётность за ${input.financials.year} год предоставлена и ожидает проверки банка`;
  } else if (request.type === "COMMENT") {
    const comment = input.comment?.trim() ?? "";
    if (comment.length < 3) throw new Error("Добавьте содержательное пояснение");
    payload = { comment };
    summary = comment;
  } else if (request.type === "DOCUMENT") {
    const files = input.files ?? [];
    if (files.length === 0 || files.some((file) => !file.name.trim() || file.size < 0)) throw new Error("Выберите требуемые файлы");
    if (files.length < request.requiredFiles.length) throw new Error("Переданы не все обязательные файлы");
    payload = { files, comment: input.comment?.trim() || null };
    summary = `Переданы документы: ${files.map((file) => file.name).join(", ")}`;
  } else if (request.type === "BKI_CONSENT") {
    if (input.consent !== true) throw new Error("Для продолжения необходимо подтвердить согласие на запрос в БКИ");
    payload = { consent: true };
    summary = "Клиент подтвердил согласие на запрос кредитной истории";
  } else if (request.type === "COMPANY_DATA") {
    const values = input.companyData ?? {};
    const allowedFields = new Set(["address", "head_name", "okved_code", "okved_name"]);
    for (const field of request.requiredFields) {
      if (!allowedFields.has(field) || !values[field]?.trim()) throw new Error(`Заполните обязательное поле: ${field}`);
    }
    const updates = Object.entries(values).filter(([field, value]) => allowedFields.has(field) && value.trim());
    if (updates.length === 0) throw new Error("Передайте запрошенные сведения о компании");
    for (const [field, value] of updates) {
      db.prepare(`UPDATE companies SET ${field} = ? WHERE id = ?`).run(value.trim(), app.company_id);
    }
    payload = { companyData: Object.fromEntries(updates) };
    summary = `Обновлены сведения о компании: ${updates.map(([field]) => field).join(", ")}`;
  } else {
    throw new Error("Системную проверку выполняет банк; действие клиента не требуется");
  }

  saveMoreInfoResponse(requestId, payload, "CLIENT", clientId);
  resumeAfterMoreInfoResponse(applicationId, requestId, "Клиент", summary);
  return getApplication(applicationId);
});

export function clientSubmitMoreInfoResponse(
  applicationId: number,
  clientId: number,
  requestId: number,
  input: MoreInfoClientResponseInput,
) {
  return clientSubmitMoreInfoResponseTransaction(applicationId, clientId, requestId, input);
}

export function clientRespondMoreInfo(applicationId: number, clientId: number, comment: string) {
  const request = getActiveMoreInfoRequest(applicationId);
  if (!request || request.type !== "COMMENT") throw new Error("Активный запрос не принимает свободный комментарий");
  return clientSubmitMoreInfoResponse(applicationId, clientId, request.id, { comment });
}

export function upsertFinancialsAndRespond(applicationId: number, clientId: number, input: FinancialReportInput) {
  const request = getActiveMoreInfoRequest(applicationId);
  if (!request || request.type !== "FINANCIALS") throw new Error("Активный запрос не требует финансовую отчётность");
  return clientSubmitMoreInfoResponse(applicationId, clientId, request.id, { financials: input });
}

const retrySystemMoreInfoTransaction = db.transaction((applicationId: number, bankUserId: number, actor: string) => {
  const app = getApplication(applicationId);
  if (!app || app.status !== "MORE_INFO") throw new Error("Нет активной системной проверки");
  const request = getActiveMoreInfoRequest(applicationId);
  if (!request || request.type !== "SYSTEM_RETRY" || request.status !== "RECHECK") throw new Error("Активный запрос не является системной проверкой");
  saveMoreInfoResponse(request.id, { action: "manual_retry" }, "BANK", bankUserId);
  markMoreInfoRecheck(request.id);
  resumeAfterMoreInfoResponse(applicationId, request.id, actor, "Сотрудник банка повторно запустил внешние проверки");
  return getApplication(applicationId);
});

export function retrySystemMoreInfo(applicationId: number, bankUserId: number, actor: string) {
  return retrySystemMoreInfoTransaction(applicationId, bankUserId, actor);
}

const reviewFinancialReportTransaction = db.transaction((
  applicationId: number,
  reportId: number,
  action: "VERIFY" | "REJECT",
  bankUserId: number,
  actor: string,
  reason?: string,
) => {
  const app = getApplication(applicationId);
  if (!app) throw new Error("Заявка не найдена");
  if (app.status !== "DECISION") throw new Error("Проверка отчётности доступна на этапе кредитного решения");
  const report = getFinancialReport(reportId);
  if (!report || report.companyId !== app.company_id) throw new Error("Отчётность не относится к компании заявки");

  if (action === "VERIFY") {
    const verified = verifyFinancialReport(reportId, bankUserId);
    const timestamp = now();
    db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(timestamp, applicationId);
    addEvent(applicationId, "DECISION", "DECISION", actor, `Финансовая отчётность за ${verified.year} год подтверждена банком`);
    return verified;
  }

  const normalizedReason = reason?.trim() ?? "";
  const rejected = rejectFinancialReport(reportId, bankUserId, normalizedReason);
  createMoreInfoRequest(applicationId, {
    type: "FINANCIALS",
    reason: `Финансовая отчётность отклонена: ${normalizedReason}`,
    requiredFields: ["year", "revenue", "profit", "own_capital", "monthly_obligations"],
  }, "BANK", bankUserId);
  setStatus(app, "MORE_INFO", actor, `Отчётность за ${rejected.year} год отклонена; запрошены исправленные данные`);
  return rejected;
});

export function reviewFinancialReport(
  applicationId: number,
  reportId: number,
  action: "VERIFY" | "REJECT",
  bankUserId: number,
  actor: string,
  reason?: string,
) {
  return reviewFinancialReportTransaction(applicationId, reportId, action, bankUserId, actor, reason);
}

export function publicNo(id: number): string {
  return "АБ-" + String(20260000 + id);
}
