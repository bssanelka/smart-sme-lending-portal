import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context, TypedResponse } from "hono";
import type { JSONValue } from "hono/utils/types";
import { apiReference } from "@scalar/hono-api-reference";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { db, now } from "./db";
import { seed } from "./seed";
import {
  getApplication, applyDecision, backfillRecommendationSnapshots, buildScoringInput, getStoredRecommendation,
  clientAcceptOffer, clientSign, clientDecline, clientRespondMoreInfo, clientSubmitMoreInfoResponse,
  issueApplication, retrySystemMoreInfo, reviewFinancialReport, upsertFinancialsAndRespond, OfferDataError, OfferExpiredError, STATUS_LABELS,
} from "./conveyor";
import { createApplicationFromCalculation, findApplicationByCalculation } from "./applications";
import { fmt, validateDecisionRate } from "./scoring";
import {
  chooseProductForCalculation, evaluateCalculator, parseCanonicalCalculationInput, productOptionEconomics,
  selectProductForNeed, toPublicCalculatorEvaluation, type NeedProduct,
} from "./calculator";

import {
  ProductEligibilityError,
  evaluateProductEligibility,
  formatEligibilityError,
  productFromRecord,
} from "./product-eligibility";
import { getClientProfile } from "./profile";
import { IdempotencyConflictError, runIdempotentCommand } from "./idempotency";
import { FixedWindowRateLimiter, hashPassword, isPasswordHash, verifyStoredPassword } from "./security";
import { getActiveMoreInfoRequest, getMoreInfoRequests, MORE_INFO_REQUEST_TYPES } from "./more-info";
import { activeFinancialReports, allowedFinancialReportYears, financialReportForScoring, listFinancialReports } from "./financial-reports";
import {
  acknowledgeDocumentPackage,
  DocumentPackageError,
  downloadableDocument,
  listDocumentMetadata,
  markDocumentOpened,
} from "./documents";
import {
  backfillExternalCheckSnapshots,
  getApplicationExternalChecks,
  localBusinessRegistryProvider,
  localCreditBureauProvider,
} from "./external-providers";

seed();
const backfilledExternalChecks = backfillExternalCheckSnapshots();
if (backfilledExternalChecks > 0) {
  console.log(`[migrate] добавлено snapshots внешних проверок: ${backfilledExternalChecks}`);
}
const backfilledRecommendations = backfillRecommendationSnapshots();
if (backfilledRecommendations > 0) {
  console.log(`[migrate] добавлено snapshots рекомендаций: ${backfilledRecommendations}`);
}
const legacyPasswords = db.prepare("SELECT id, password FROM users").all() as Array<{ id: number; password: string }>;
const migrateLegacyPasswords = db.transaction(() => {
  const update = db.prepare("UPDATE users SET password = ? WHERE id = ?");
  for (const user of legacyPasswords) {
    if (!isPasswordHash(user.password)) update.run(hashPassword(user.password), user.id);
  }
});
migrateLegacyPasswords();

const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (result.success) return;
    const message = result.error.issues.map((issue) => issue.message).join("; ") || "Некорректные параметры запроса";
    return c.json({ ok: false as const, error: message }, 400);
  },
});
type Row = Record<string, unknown>;
type AuthenticatedUser = {
  id: number;
  login: string;
  name: string;
  role: "CLIENT" | "BANK";
  company_id: number | null;
  position: string | null;
};

const secureCookies = process.env.COOKIE_SECURE === "true";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const loginLimiter = new FixedWindowRateLimiter(10, 15 * 60 * 1000);

app.onError((error, c) => {
  console.error("[api] unhandled error", error);
  return c.json({ ok: false as const, error: "Внутренняя ошибка сервера" }, 500);
});

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (secureCookies) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
});

// ---------------------------------------------------------------------------
// Сессии и авторизация (синтетические тестовые учётные записи)
// ---------------------------------------------------------------------------
function currentUser(c: Context): AuthenticatedUser | null {
  const sid = getCookie(c, "sid");
  if (!sid) return null;
  const session = db.prepare(`
    SELECT u.id, u.login, u.name, u.role, u.company_id, u.position, s.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(sid) as Row | undefined;
  if (!session) return null;

  const createdAt = Date.parse(String(session.created_at));
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > sessionTtlMs) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(sid);
    return null;
  }

  return {
    id: session.id as number,
    login: session.login as string,
    name: session.name as string,
    role: session.role as AuthenticatedUser["role"],
    company_id: session.company_id as number | null,
    position: session.position as string | null,
  };
}

function requireUser(c: Context): AuthenticatedUser | null {
  const u = currentUser(c);
  if (!u) { c.json({ error: "Требуется авторизация" }, 401); }
  return u;
}

const UserSchema = z.object({
  id: z.number(), login: z.string(), name: z.string(), role: z.enum(["CLIENT", "BANK"]),
  company_id: z.number().nullable(), position: z.string().nullable(),
}).openapi("User");
const ErrorSchema = z.object({ ok: z.literal(false), error: z.string() }).openapi("ApiError");
const GenericSuccessSchema = z.object({ ok: z.literal(true), data: z.unknown() }).openapi("GenericSuccess");
const ApplicationStatusSchema = z.enum(["SUBMITTED", "DATA_CHECK", "ENRICHMENT", "SCORING", "DECISION", "MORE_INFO", "OFFER", "DOCUMENTS", "SIGNING", "READY_FOR_ISSUANCE", "ISSUED", "REJECTED", "DECLINED_BY_CLIENT"]);
const DecisionTypeSchema = z.enum(["APPROVE", "CONDITIONS", "MORE_INFO", "REJECT"]);
const DocumentStatusSchema = z.enum(["UPLOADED", "GENERATED", "SIGNED", "UNAVAILABLE"]);
app.openAPIRegistry.register("ApplicationStatus", ApplicationStatusSchema);
app.openAPIRegistry.register("DecisionType", DecisionTypeSchema);
app.openAPIRegistry.register("DocumentStatus", DocumentStatusSchema);
app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", { type: "apiKey", in: "cookie", name: "sid" });

const jsonResponse = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const standardResponses = (description = "Успешный ответ") => ({
  200: jsonResponse(GenericSuccessSchema, description),
  400: jsonResponse(ErrorSchema, "Некорректный запрос"),
  401: jsonResponse(ErrorSchema, "Требуется авторизация"),
  403: jsonResponse(ErrorSchema, "Недостаточно прав"),
  404: jsonResponse(ErrorSchema, "Ресурс не найден"),
  409: jsonResponse(ErrorSchema, "Конфликт состояния"),
  415: jsonResponse(ErrorSchema, "Неподдерживаемый тип содержимого"),
  429: jsonResponse(ErrorSchema, "Слишком много запросов"),
  500: jsonResponse(ErrorSchema, "Внутренняя ошибка сервера"),
});

const ok = <T>(data: T) => ({ ok: true as const, data });
const err = (error: string) => ({ ok: false as const, error });

type CommandErrorStatus = 400 | 403 | 404 | 409;

class CommandValidationError extends Error {
  constructor(message: string, readonly status: CommandErrorStatus) {
    super(message);
    this.name = "CommandValidationError";
  }
}

type IdempotentJsonResponse =
  | TypedResponse<JSONValue, 200, "json">
  | TypedResponse<JSONValue, CommandErrorStatus, "json">;

function idempotentJson<T>(
  c: Context,
  command: { userId: number; operation: string; request: unknown; execute: () => T },
): IdempotentJsonResponse {
  const key = c.req.header("Idempotency-Key")?.trim() ?? "";
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    return c.json(err("Для команды требуется корректный заголовок Idempotency-Key длиной от 8 до 128 символов"), 400) as TypedResponse<JSONValue, 400, "json">;
  }

  try {
    const result = runIdempotentCommand(db, { ...command, key });
    if (result.replayed) c.header("Idempotency-Replayed", "true");
    return c.json(ok(result.value)) as unknown as TypedResponse<JSONValue, 200, "json">;
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return c.json(err(error.message), 409) as TypedResponse<JSONValue, 409, "json">;
    if (error instanceof CommandValidationError) return c.json(err(error.message), error.status) as TypedResponse<JSONValue, CommandErrorStatus, "json">;
    throw error;
  }
}

const jsonBody = <T extends z.ZodType>(schema: T) => ({ body: { content: { "application/json": { schema } }, required: true as const } });

// --- auth ---
app.openapi(createRoute({
  method: "post", path: "/api/auth/login", operationId: "login", tags: ["Auth"], security: [],
  summary: "Вход (синтетическая учётная запись)",
  request: jsonBody(z.object({ login: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) })),
  responses: { ...standardResponses(), 200: jsonResponse(z.object({ ok: z.literal(true), data: UserSchema }).openapi("LoginSuccess"), "Вход выполнен") },
}), (c) => {
  const { login, password } = c.req.valid("json");
  const loginKey = login.toLowerCase();
  const rateLimit = loginLimiter.consume(loginKey);
  if (!rateLimit.allowed) {
    c.header("Retry-After", String(rateLimit.retryAfterSeconds));
    return c.json(err("Слишком много попыток входа. Повторите позже."), 429);
  }

  const u = db.prepare("SELECT * FROM users WHERE login = ?").get(login) as Row | undefined;
  const verification = u ? verifyStoredPassword(password, String(u.password)) : { valid: false, needsRehash: false };
  if (!u || !verification.valid) return c.json(err("Неверный логин или пароль"), 401);

  if (verification.needsRehash) {
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashPassword(password), u.id);
  }
  loginLimiter.reset(loginKey);
  db.prepare("DELETE FROM sessions WHERE created_at < ?").run(new Date(Date.now() - sessionTtlMs).toISOString());
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)").run(token, u.id, now());
  setCookie(c, "sid", token, { httpOnly: true, sameSite: "Lax", secure: secureCookies, path: "/", maxAge: sessionTtlMs / 1000 });
  return c.json(ok({ id: u.id, login: u.login, name: u.name, role: u.role, company_id: u.company_id, position: u.position }));
});

app.openapi(createRoute({
  method: "post", path: "/api/auth/logout", operationId: "logout", tags: ["Auth"], summary: "Выход",
  responses: standardResponses("Сессия завершена"),
}), (c) => {
  const sid = getCookie(c, "sid");
  if (sid) db.prepare("DELETE FROM sessions WHERE token = ?").run(sid);
  deleteCookie(c, "sid");
  return c.json(ok(null));
});

app.openapi(createRoute({
  method: "get", path: "/api/auth/me", operationId: "getCurrentUser", tags: ["Auth"], security: [], summary: "Текущий пользователь",
  responses: { ...standardResponses(), 200: jsonResponse(z.object({ ok: z.literal(true), data: z.union([UserSchema, z.null()]) }).openapi("CurrentUserSuccess"), "Текущий пользователь") },
}), (c) => c.json(ok(currentUser(c))));

app.openapi(createRoute({
  method: "get", path: "/api/client/profile", operationId: "getClientProfile", tags: ["Client"],
  summary: "Профиль клиента, показатели бизнеса и предварительно подходящие льготы",
  responses: standardResponses("Профиль клиента"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "CLIENT" || typeof u.company_id !== "number") return c.json(err("Только для клиентов"), 403);
  return c.json(ok(getClientProfile({
    id: u.id as number,
    login: u.login as string,
    name: u.name as string,
    role: u.role as string,
    company_id: u.company_id,
    position: u.position as string | null,
  })));
});

// --- meta ---
app.openapi(createRoute({
  method: "get", path: "/api/health", operationId: "getHealth", tags: ["Meta"], security: [], summary: "Состояние сервиса",
  responses: standardResponses("Сервис доступен"),
}), (c) => c.json(ok({ status: "up", assistantMode: "template", time: now() })));

// --- products ---
const ProductSchema = z.object({
  id: z.number(), code: z.string(), name: z.string(), tagline: z.string(), description: z.string(),
  min_amount: z.number(), max_amount: z.number(), rate_from: z.number(), term_min: z.number(), term_max: z.number(),
  purpose_tags: z.string(), features: z.string(), min_revenue: z.number(),
});

app.openapi(createRoute({
  method: "get", path: "/api/products", operationId: "listProducts", tags: ["Products"], security: [], summary: "Каталог кредитных продуктов",
  responses: { ...standardResponses(), 200: jsonResponse(z.object({ ok: z.literal(true), data: z.array(ProductSchema) }).openapi("ProductListSuccess"), "Каталог продуктов") },
}), (c) => c.json(ok(db.prepare("SELECT id,code,name,tagline,description,min_amount,max_amount,rate_from,term_min,term_max,purpose_tags,features,min_revenue FROM products").all() as Array<z.infer<typeof ProductSchema>>)));

app.openapi(createRoute({
  method: "get", path: "/api/products/{id}", operationId: "getProduct", tags: ["Products"], security: [], summary: "Продукт по id",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: { ...standardResponses(), 200: jsonResponse(z.object({ ok: z.literal(true), data: ProductSchema }).openapi("ProductSuccess"), "Карточка продукта") },
}), (c) => {
  const p = db.prepare("SELECT id,code,name,tagline,description,min_amount,max_amount,rate_from,term_min,term_max,purpose_tags,features,min_revenue FROM products WHERE id = ?").get(c.req.valid("param").id);
  if (!p) return c.json(err("Продукт не найден"), 404);
  return c.json(ok(p));
});

// --- preliminary calculator (client) ---
const CalculatorRequestSchema = z.object({
  amount: z.number().positive().max(150_000_000),
  term_months: z.number().int().min(3).max(84),
  purpose_category: z.string().trim().min(2),
  product_id: z.number().int().positive().optional(),
  scenario: z.object({
    bki_score: z.number().min(300).max(900).optional(),
    pdn: z.number().min(0).max(200).optional(),
    margin_percent: z.number().min(-100).max(100).optional(),
  }).optional(),
});

app.openapi(createRoute({
  method: "post", path: "/api/calculator/evaluate", operationId: "evaluateCalculator", tags: ["Calculator"],
  summary: "Предварительная rule-based оценка кредита для текущего клиента",
  request: jsonBody(CalculatorRequestSchema),
  responses: standardResponses("Предварительная оценка рассчитана"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "CLIENT" || typeof u.company_id !== "number") return c.json(err("Только для клиентов"), 403);
  const input = c.req.valid("json");
  const products = (db.prepare("SELECT * FROM products ORDER BY id").all() as Row[]).map((product): NeedProduct => ({
    id: product.id as number,
    code: product.code as string,
    name: product.name as string,
    tagline: product.tagline as string,
    minAmount: product.min_amount as number,
    maxAmount: product.max_amount as number,
    rateFrom: product.rate_from as number,
    termMin: product.term_min as number,
    termMax: product.term_max as number,
    purposeTags: String(product.purpose_tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    minRevenue: product.min_revenue as number,
  }));
  const initialScoringInput = buildScoringInput({ company_id: u.company_id, amount: input.amount });
  let selection;
  try {
    selection = selectProductForNeed(products, {
      amount: input.amount,
      termMonths: input.term_months,
      purposeCategory: input.purpose_category,
      annualRevenue: initialScoringInput.revenueAnnual,
    });
  } catch (error) {
    if (error instanceof ProductEligibilityError) return c.json(err(error.message), 409);
    throw error;
  }
  let calculationSelection;
  try {
    calculationSelection = chooseProductForCalculation(selection, input.product_id);
  } catch (error) {
    if (error instanceof ProductEligibilityError) return c.json(err(error.message), 409);
    throw error;
  }
  const { selected, source: selectionSource, systemRecommendedProductId } = calculationSelection;
  selection = calculationSelection.selection;
  const financials = activeFinancialReports(u.company_id);
  const creditHistory = db.prepare(`
    SELECT active_credits, total_debt, monthly_payment
    FROM credit_history WHERE company_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(u.company_id) as Row | undefined;
  const refinancing = creditHistory ? {
    activeCredits: creditHistory.active_credits as number,
    totalDebt: creditHistory.total_debt as number,
    monthlyCreditPayment: creditHistory.monthly_payment as number,
  } : null;
  const calculatorInputFor = (option: typeof selected) => ({
    amount: option.amount,
    termMonths: option.termMonths,
    product: { maxAmount: option.product.maxAmount, rateFrom: option.product.rateFrom },
    scoringInput: buildScoringInput({ company_id: u.company_id as number, amount: option.amount }),
    previousRevenue: financials[1]?.revenue ?? null,
    refinancing,
  });
  const scenario = input.scenario ? {
    bkiScore: input.scenario.bki_score,
    pdn: input.scenario.pdn,
    marginPercent: input.scenario.margin_percent,
  } : undefined;
  const result = evaluateCalculator(calculatorInputFor(selected), scenario);
  const selectionWithEconomics = {
    ...selection,
    recommended: { ...selection.recommended, economics: productOptionEconomics(result.current) },
    alternatives: selection.alternatives.map((option) => ({
      ...option,
      economics: productOptionEconomics(evaluateCalculator(calculatorInputFor(option)).current),
    })),
  };
  const normalizedInput = {
    product_id: selected.product.id,
    amount: selected.amount,
    term_months: selected.termMonths,
    purpose_category: input.purpose_category,
    requested_amount: input.amount,
    requested_term_months: input.term_months,
    selection_source: selectionSource,
    system_recommended_product_id: systemRecommendedProductId,
    scenario: input.scenario,
  };
  const calculationId = Number(db.prepare(`INSERT INTO calculator_runs
    (user_id, company_id, product_id, input_json, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`) 
    .run(u.id, u.company_id, selected.product.id, JSON.stringify(normalizedInput), JSON.stringify({ result, selection: selectionWithEconomics }), now()).lastInsertRowid);

  return c.json(ok({ calculation_id: calculationId, selection: selectionWithEconomics, ...toPublicCalculatorEvaluation(result) }));
});

app.openapi(createRoute({
  method: "get", path: "/api/calculator/runs/{id}", operationId: "getCalculatorRun", tags: ["Calculator"],
  summary: "Канонические параметры сохранённого расчёта для предзаполненной заявки",
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: standardResponses("Сохранённый расчёт"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "CLIENT") return c.json(err("Только для клиентов"), 403);
  const calculation = db.prepare("SELECT * FROM calculator_runs WHERE id = ?").get(c.req.valid("param").id) as Row | undefined;
  if (!calculation) return c.json(err("Расчёт не найден"), 404);
  if (calculation.user_id !== u.id || calculation.company_id !== u.company_id) return c.json(err("Нет доступа"), 403);
  const input = JSON.parse(calculation.input_json as string) as {
    product_id: number; amount: number; term_months: number; purpose_category: string;
    requested_amount?: number; requested_term_months?: number;
    selection_source?: "SYSTEM_RECOMMENDED" | "CLIENT_ALTERNATIVE";
  };
  const product = db.prepare("SELECT id, code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max, purpose_tags, features, min_revenue FROM products WHERE id = ?")
    .get(calculation.product_id as number);
  const existingApplication = findApplicationByCalculation(calculation.id as number);
  const application = existingApplication
    && existingApplication.client_id === u.id
    && existingApplication.company_id === u.company_id
    ? { id: existingApplication.id, public_no: existingApplication.public_no, status: existingApplication.status }
    : null;
  return c.json(ok({
    calculation_id: calculation.id,
    selection_source: input.selection_source ?? "SYSTEM_RECOMMENDED",
    product,
    amount: input.amount,
    term_months: input.term_months,
    purpose_category: input.purpose_category,
    requested_amount: input.requested_amount ?? input.amount,
    requested_term_months: input.requested_term_months ?? input.term_months,
    created_at: calculation.created_at,
    application,
  }));
});

// --- applications (client) ---

const PreliminaryTermsSchema = z.object({
  productName: z.string(),
  amount: z.number(),
  termMonths: z.number().int(),
  rate: z.number(),
  monthlyPayment: z.number(),
  overpayment: z.number(),
  totalPayment: z.number(),
});

const FinalRiskAssessmentSchema = z.object({
  scorecardVersion: z.string(),
  score: z.number(),
  grade: z.enum(["A", "B", "C", "D"]),
  factors: z.array(z.object({
    key: z.string(), label: z.string(), value: z.string(), points: z.number(), explanation: z.string(),
  })),
  assessedAmount: z.number(),
  productId: z.number().int(),
  productName: z.string(),
  calculatedAt: z.string(),
});

const StoredDecisionSchema = z.object({
  type: z.enum(["APPROVE", "CONDITIONS", "MORE_INFO", "REJECT"]),
  rate: z.number().nullable(),
  amount: z.number().nullable(),
  termMonths: z.number().int().nullable(),
  reason: z.string(),
  decidedAt: z.string(),
  productId: z.number().int().optional(),
  productName: z.string().optional(),
  monthlyPayment: z.number().optional(),
  overpayment: z.number().optional(),
  totalPayment: z.number().optional(),
  paymentType: z.literal("ANNUITY").optional(),
  feesIncluded: z.literal(false).optional(),
  validUntil: z.string().optional(),
  preliminaryTerms: PreliminaryTermsSchema.optional(),
  finalRiskAssessment: FinalRiskAssessmentSchema.optional(),
});

type StoredDecision = z.infer<typeof StoredDecisionSchema>;

function storedDecision(raw: unknown): StoredDecision | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = StoredDecisionSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function appWithProduct(a: Row) {
  const p = db.prepare("SELECT name, rate_from FROM products WHERE id = ?").get(a.product_id as number) as Row;
  const decision = storedDecision(a.decision);
  const moreInfoRequests = getMoreInfoRequests(a.id as number);
  return {
    ...a,
    decision,
    preliminaryTerms: decision?.preliminaryTerms ?? null,
    more_info_requests: moreInfoRequests,
    active_more_info_request: moreInfoRequests.find((request) => ["WAITING_CLIENT", "CLIENT_RESPONDED", "RECHECK"].includes(request.status)) ?? null,
    product_name: p?.name,
    product_rate_from: p?.rate_from,
    status_label: STATUS_LABELS[a.status as string] || a.status,
  };
}

const CLIENT_SCORE_FACTOR_KEYS = new Set(["bki", "overdue", "pdn", "amount_ratio"]);

function clientApplicationView(a: Row) {
  const enriched = appWithProduct(a);
  const publicApplication: Row = { ...enriched };
  delete publicApplication.score;
  delete publicApplication.grade;
  delete publicApplication.score_details;
  delete publicApplication.scorecard_version;
  const publicDecision = enriched.decision ? { ...enriched.decision, finalRiskAssessment: undefined } : null;
  const preapproval = a.status === "DECISION"
    ? (a.grade === "A" || a.grade === "B"
        ? {
            status: "PREAPPROVED",
            label: "Предварительная автоматическая проверка пройдена",
            description: "Профиль соответствует базовым условиям. Это не одобрение и не оферта — финальное решение принимает сотрудник банка.",
          }
        : {
            status: "REVIEW",
            label: "Требуется рассмотрение сотрудником",
            description: "Автоматическая оценка завершена. Сотрудник банка проверит риски и может предложить другие сумму, срок или продукт.",
          })
    : null;
  return { ...publicApplication, decision: publicDecision, preapproval };
}

function clientScoreDetails(raw: unknown) {
  if (typeof raw !== "string" || !raw) return null;
  const factors = JSON.parse(raw) as Array<{ key: string; label: string; value: string; points: number; explanation: string }>;
  return factors.filter((factor) => CLIENT_SCORE_FACTOR_KEYS.has(factor.key)).map(({ key, label, value, explanation }) => ({ key, label, value, explanation }));
}

function clientEvents(events: Row[]) {
  return events.map((event) => event.to_status === "DECISION"
    ? { ...event, comment: "Оценка завершена, заявка передана на принятие кредитного решения" }
    : event);
}


app.openapi(createRoute({
  method: "post", path: "/api/applications", operationId: "createApplication", tags: ["Applications"], summary: "Подать заявку на кредит (запускает конвейер)",
  request: jsonBody(z.object({
    purpose: z.string().trim().min(5),
    calculation_id: z.number().int().positive(),
  })),
  responses: standardResponses("Заявка создана"),
}), (c) => {
  const u = requireUser(c);
  if (!u || u.role !== "CLIENT" || u.company_id === null) return c.json(err("Только клиент компании может подавать заявки"), 403);
  const input = c.req.valid("json");
  const companyId = u.company_id;
  return idempotentJson(c, {
    userId: u.id,
    operation: "applications:create",
    request: input,
    execute: () => {
      const { purpose, calculation_id } = input;
      const calculation = db.prepare("SELECT user_id, company_id, product_id, input_json FROM calculator_runs WHERE id = ?")
        .get(calculation_id) as Row | undefined;
      if (!calculation || calculation.user_id !== u.id || calculation.company_id !== companyId) {
        throw new CommandValidationError("Расчёт не найден или не принадлежит клиенту", 403);
      }

      let canonical;
      try {
        canonical = parseCanonicalCalculationInput(calculation.input_json as string, calculation.product_id as number);
      } catch {
        throw new CommandValidationError("Сохранённый расчёт повреждён — выполните расчёт повторно", 409);
      }
      const p = db.prepare("SELECT * FROM products WHERE id = ?").get(canonical.productId) as Row | undefined;
      if (!p) throw new CommandValidationError("Продукт расчёта не найден", 404);
      if (canonical.amount < (p.min_amount as number) || canonical.amount > (p.max_amount as number)) {
        throw new CommandValidationError(`Сумма должна быть от ${fmt(p.min_amount as number)} до ${fmt(p.max_amount as number)} ₽`, 400);
      }
      if (canonical.termMonths < (p.term_min as number) || canonical.termMonths > (p.term_max as number)) {
        throw new CommandValidationError(`Срок от ${p.term_min} до ${p.term_max} мес.`, 400);
      }
      const currentScoringInput = buildScoringInput({ company_id: companyId, amount: canonical.amount });
      const currentEligibility = evaluateProductEligibility(productFromRecord(p), {
        amount: canonical.amount,
        termMonths: canonical.termMonths,
        purposeCategory: canonical.purposeCategory,
        annualRevenue: currentScoringInput.revenueAnnual,
      });
      if (!currentEligibility.eligible) {
        throw new CommandValidationError(`Сохранённый расчёт больше не соответствует ограничениям продукта. ${formatEligibilityError(productFromRecord(p), currentEligibility)}. Выполните расчёт повторно.`, 409);
      }

      return createApplicationFromCalculation({
        id: u.id,
        company_id: companyId,
        name: u.name,
      }, {
        product_id: canonical.productId,
        amount: canonical.amount,
        term_months: canonical.termMonths,
        purpose,
        purpose_category: canonical.purposeCategory,
        calculation_id,
      });
    },
  });
});

app.openapi(createRoute({
  method: "get", path: "/api/applications/mine", operationId: "listMyApplications", tags: ["Applications"], summary: "Мои заявки",
  responses: standardResponses("Список заявок клиента"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  const rows = db.prepare("SELECT * FROM applications WHERE client_id = ? ORDER BY id DESC").all(u.id) as Row[];
  return c.json(ok(rows.map(clientApplicationView)));
});

app.openapi(createRoute({
  method: "get", path: "/api/applications/{id}", operationId: "getApplication", tags: ["Applications"], summary: "Карточка заявки с ходом процесса",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: standardResponses("Карточка заявки"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  const a = getApplication(c.req.valid("param").id);
  if (!a) return c.json(err("Заявка не найдена"), 404);
  if (u.role !== "BANK" && a.client_id !== u.id) return c.json(err("Нет доступа"), 403);
  const events = db.prepare("SELECT * FROM application_events WHERE application_id = ? ORDER BY id").all(a.id) as Row[];
  const docs = listDocumentMetadata(a.id as number);
  const isBank = u.role === "BANK";
  const msgs = isBank
    ? []
    : db.prepare("SELECT * FROM chat_messages WHERE application_id = ? ORDER BY id").all(a.id) as Row[];
  const applicationView = isBank ? appWithProduct(a) : clientApplicationView(a);
  return c.json(ok({
    ...applicationView,
    events: isBank ? events : clientEvents(events),
    documents: docs,
    chat: msgs,
    decision: applicationView.decision,
    score_details: isBank ? (a.score_details ? JSON.parse(a.score_details as string) : null) : clientScoreDetails(a.score_details),
  }));
});

app.openapi(createRoute({
  method: "get", path: "/api/documents/{id}/download", operationId: "downloadDocument", tags: ["Applications"],
  summary: "Скачать синтетический документ для ознакомления",
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: { ...standardResponses(), 200: { description: "Текстовый демонстрационный документ", content: { "text/plain": { schema: z.string() } } } },
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  let document;
  try {
    document = downloadableDocument(c.req.valid("param").id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Документ недоступен";
    return c.json(err(message), message === "Документ не найден" ? 404 : 409);
  }
  const application = getApplication(document.application_id);
  if (!application) return c.json(err("Заявка не найдена"), 404);
  if (u.role !== "BANK" && application.client_id !== u.id) return c.json(err("Нет доступа"), 403);
  if (u.role === "CLIENT") markDocumentOpened(document.id, u.id as number);
  return c.text(document.content, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="document.txt"; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
    "X-Document-Version": document.document_version!,
    "X-Content-SHA256": document.content_hash!,
    "Cache-Control": "no-store",
  });
});

app.openapi(createRoute({
  method: "post", path: "/api/applications/{id}/documents/acknowledge", operationId: "acknowledgeDocuments", tags: ["Applications"],
  summary: "Подтвердить ознакомление со всем скачанным пакетом документов",
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: standardResponses("Ознакомление подтверждено"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "CLIENT") return c.json(err("Только клиент может подтвердить ознакомление"), 403);
  const applicationId = c.req.valid("param").id;
  return idempotentJson(c, {
    userId: u.id,
    operation: `applications:${applicationId}:documents:acknowledge`,
    request: {},
    execute: () => {
      const application = getApplication(applicationId);
      if (!application || application.client_id !== u.id) throw new CommandValidationError("Нет доступа", 403);
      try {
        acknowledgeDocumentPackage(applicationId, u.id as number);
        return { documents: listDocumentMetadata(applicationId) };
      } catch (error) {
        throw new CommandValidationError(error instanceof Error ? error.message : "Не удалось подтвердить ознакомление", 409);
      }
    },
  });
});

app.openapi(createRoute({
  method: "post", path: "/api/applications/{id}/accept", operationId: "acceptOffer", tags: ["Applications"], summary: "Клиент принимает предложенные условия",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: standardResponses("Предложение принято"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  const applicationId = c.req.valid("param").id;
  return idempotentJson(c, {
    userId: u.id,
    operation: `applications:${applicationId}:accept`,
    request: {},
    execute: () => {
      const a = getApplication(applicationId);
      if (!a || a.client_id !== u.id) throw new CommandValidationError("Нет доступа", 403);
      try {
        clientAcceptOffer(applicationId);
      } catch (error) {
        if (error instanceof OfferExpiredError || error instanceof OfferDataError) throw new CommandValidationError(error.message, 409);
        throw new CommandValidationError(error instanceof Error ? error.message : "Предложение нельзя принять в текущем статусе", 409);
      }
      return clientApplicationView(getApplication(applicationId) as Row);
    },
  });
});

app.openapi(createRoute({
  method: "post", path: "/api/applications/{id}/sign", operationId: "signDocuments", tags: ["Applications"], summary: "Клиент подписывает документы (модельная операция)",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: standardResponses("Документы подписаны в demo-режиме"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  const applicationId = c.req.valid("param").id;
  return idempotentJson(c, {
    userId: u.id,
    operation: `applications:${applicationId}:sign`,
    request: {},
    execute: () => {
      const a = getApplication(applicationId);
      if (!a || a.client_id !== u.id) throw new CommandValidationError("Нет доступа", 403);
      try {
        clientSign(applicationId, u.id as number);
      } catch (error) {
        if (error instanceof DocumentPackageError) throw new CommandValidationError(error.message, 409);
        throw new CommandValidationError(error instanceof Error ? error.message : "Не удалось выполнить model-подписание", 409);
      }
      return clientApplicationView(getApplication(applicationId) as Row);
    },
  });
});

app.openapi(createRoute({
  method: "post", path: "/api/applications/{id}/decline", operationId: "declineOffer", tags: ["Applications"], summary: "Клиент отказывается от предложения",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: standardResponses("Предложение отклонено"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  const applicationId = c.req.valid("param").id;
  return idempotentJson(c, {
    userId: u.id,
    operation: `applications:${applicationId}:decline`,
    request: {},
    execute: () => {
      const a = getApplication(applicationId);
      if (!a || a.client_id !== u.id) throw new CommandValidationError("Нет доступа", 403);
      try {
        clientDecline(applicationId);
      } catch (error) {
        throw new CommandValidationError(error instanceof Error ? error.message : "Не удалось отклонить предложение", 409);
      }
      return clientApplicationView(getApplication(applicationId) as Row);
    },
  });
});

const [minimumFinancialYear, maximumFinancialYear] = allowedFinancialReportYears();

const MoreInfoResponseSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
  financials: z.object({
    year: z.number().int().min(minimumFinancialYear).max(maximumFinancialYear),
    revenue: z.number().finite().nonnegative(),
    profit: z.number().finite(),
    own_capital: z.number().finite().nonnegative(),
    monthly_obligations: z.number().finite().nonnegative(),
    comment: z.string().trim().max(2000).optional(),
  }).optional(),
  files: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    size: z.number().int().nonnegative().max(18 * 1024 * 1024),
    type: z.string().max(255),
  })).max(20).optional(),
  consent: z.boolean().optional(),
  company_data: z.record(z.string(), z.string().trim().max(1000)).optional(),
});

app.openapi(createRoute({
  method: "post", path: "/api/applications/{id}/more-info/{requestId}/response", operationId: "respondToMoreInfo", tags: ["Applications"],
  summary: "Типизированный ответ клиента на активный запрос дополнительной информации",
  request: {
    params: z.object({ id: z.coerce.number().int().positive(), requestId: z.coerce.number().int().positive() }),
    ...jsonBody(MoreInfoResponseSchema),
  },
  responses: standardResponses("Ответ сохранён, повторная проверка запущена"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "CLIENT") return c.json(err("Только клиент может отвечать на запрос"), 403);
  const { id, requestId } = c.req.valid("param");
  const a = getApplication(id);
  if (!a || a.client_id !== u.id) return c.json(err("Нет доступа"), 403);
  const body = c.req.valid("json");
  try {
    const updated = clientSubmitMoreInfoResponse(id, u.id as number, requestId, {
      comment: body.comment,
      financials: body.financials ? {
        year: body.financials.year,
        revenue: body.financials.revenue,
        profit: body.financials.profit,
        ownCapital: body.financials.own_capital,
        monthlyObligations: body.financials.monthly_obligations,
        comment: body.financials.comment,
      } : undefined,
      files: body.files,
      consent: body.consent,
      companyData: body.company_data,
    });
    return c.json(ok(clientApplicationView(updated as Row)));
  } catch (error) {
    return c.json(err(error instanceof Error ? error.message : "Не удалось сохранить ответ"), 409);
  }
});

app.openapi(createRoute({
  method: "post", path: "/api/applications/{id}/respond", operationId: "respondWithComment", tags: ["Applications"], summary: "Совместимый ответ на запрос типа COMMENT",
  request: { params: z.object({ id: z.coerce.number() }), ...jsonBody(z.object({ comment: z.string().min(3) })) },
  responses: standardResponses("Ответ сохранён"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  const a = getApplication(c.req.valid("param").id);
  if (!a || a.client_id !== u.id) return c.json(err("Нет доступа"), 403);
  clientRespondMoreInfo(a.id as number, u.id as number, c.req.valid("json").comment);
  return c.json(ok(clientApplicationView(getApplication(a.id as number) as Row)));
});

app.openapi(createRoute({
  method: "post", path: "/api/applications/{id}/financials", operationId: "provideFinancials", tags: ["Applications"],
  summary: "Добавить финансовую отчётность по запросу уточнения и повторно запустить конвейер",
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
    ...jsonBody(z.object({
      year: z.number().int().min(minimumFinancialYear).max(maximumFinancialYear),
      revenue: z.number().finite().nonnegative(),
      profit: z.number().finite(),
      own_capital: z.number().finite().nonnegative(),
      monthly_obligations: z.number().finite().nonnegative(),
      comment: z.string().max(2000).optional(),
    })),
  },
  responses: standardResponses("Финансовые данные сохранены"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "CLIENT") return c.json(err("Только клиент может добавлять отчётность"), 403);
  const applicationId = c.req.valid("param").id;
  const a = getApplication(applicationId);
  if (!a) return c.json(err("Заявка не найдена"), 404);
  if (a.client_id !== u.id) return c.json(err("Нет доступа"), 403);
  if (a.status !== "MORE_INFO") return c.json(err("Финансовую отчётность можно добавить только в статусе MORE_INFO"), 409);
  const report = c.req.valid("json");
  const updated = upsertFinancialsAndRespond(applicationId, u.id as number, {
    year: report.year,
    revenue: report.revenue,
    profit: report.profit,
    ownCapital: report.own_capital,
    monthlyObligations: report.monthly_obligations,
    comment: report.comment,
  });
  return c.json(ok(clientApplicationView(updated as Row)));
});

// --- news (персональная лента под ОКВЭД клиента) ---
app.openapi(createRoute({
  method: "get", path: "/api/news", operationId: "listNews", tags: ["News"], summary: "Новостная лента, персонализированная под профиль клиента",
  responses: standardResponses("Новостная лента"),
}), (c) => {
  const u = currentUser(c);
  let okved = "";
  if (u?.role === "CLIENT" && u.company_id) {
    const comp = db.prepare("SELECT okved_code FROM companies WHERE id = ?").get(u.company_id) as Row | undefined;
    okved = (comp?.okved_code as string) || "";
  }
  const rows = db.prepare("SELECT * FROM news ORDER BY published_at DESC").all() as Row[];
  const scored: Array<Row & { personalized: boolean; matched_tag: string | null; rank: number }> = rows.map((n) => {
    const tags = (n.tags as string).split(",");
    const matched = Boolean(okved) && tags.includes(okved);
    const general = tags.includes("любой") || tags.some((t) => (t as string).startsWith("оборотные") || (t as string).startsWith("налоги"));
    return { ...n, personalized: matched, matched_tag: matched ? okved : null, rank: matched ? 0 : general ? 1 : 2 };
  });
  scored.sort((a, b) => a.rank - b.rank || String(b.published_at).localeCompare(String(a.published_at)));
  return c.json(ok(scored));
});

// --- Детерминированный шаблонный помощник клиента ---
app.openapi(createRoute({
  method: "post", path: "/api/assistant", operationId: "askTemplateAssistant", tags: ["Assistant"],
  summary: "Вопрос к шаблонному помощнику клиента",
  request: jsonBody(z.object({
    application_id: z.number().int().positive().optional(),
    message: z.string().trim().min(2).max(1000),
  })),
  responses: standardResponses("Шаблонный ответ помощника"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "CLIENT") return c.json(err("Только для клиентов"), 403);
  const { application_id, message } = c.req.valid("json");
  let context = "";
  if (application_id !== undefined) {
    const a = getApplication(application_id);
    if (!a) return c.json(err("Заявка не найдена"), 404);
    if (a.client_id !== u.id) return c.json(err("Нет доступа"), 403);
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(a.product_id as number) as Row;
    context = `Заявка ${a.public_no}: продукт «${p.name}», сумма ${a.amount} руб., срок ${a.term_months} мес., статус «${STATUS_LABELS[a.status as string]}». Цель: ${a.purpose}.`;
  }
  const result = { text: templateAnswer(message, context), source: "template" as const };
  if (application_id !== undefined) {
    db.transaction(() => {
      db.prepare("INSERT INTO chat_messages (application_id, role, content, source, created_at) VALUES (?,?,?,?,?)")
        .run(application_id, "user", message, "user", now());
      db.prepare("INSERT INTO chat_messages (application_id, role, content, source, created_at) VALUES (?,?,?,?,?)")
        .run(application_id, "assistant", result.text, result.source, now());
    })();
  }
  return c.json(ok(result));
});

function templateAnswer(message: string, context: string): string {
  const m = message.toLowerCase();
  if (m.includes("ставк") || m.includes("процент"))
    return "Ставка зависит от продукта и скоринговой оценки: чем надёжнее финансовое положение и кредитная история, тем ниже ставка. Точные условия будут в предложении банка после рассмотрения заявки.";
  if (m.includes("документ") || m.includes("справк"))
    return "Обычно нужны: паспорт руководителя, финансовая отчётность за последний год и данные о цели кредита. Если чего-то не хватит, банк запросит уточнение прямо в кабинете — заявка не будет отклонена молча.";
  if (m.includes("сколько") && (m.includes("ждать") || m.includes("долго") || m.includes("время")))
    return "Автоматическая предварительная проверка занимает минуты. Финальное решение подтверждает сотрудник банка; ориентировочный срок — до одного рабочего дня. Текущий статус всегда виден в карточке заявки.";
  if (m.includes("отказ")) return "Отказ не является окончательным: он зависит от текущего профиля риска. Снижение долговой нагрузки, погашение просрочек и повторная подача через несколько месяцев улучшают шансы.";
  if (m.includes("услови")) return "Банк может одобрить сумму или срок, отличающиеся от запрошенных, — это изменённые условия, которые можно принять или отклонить. Решение всегда объясняется.";
  if (context) return "По вашей заявке: статус и следующие шаги отображаются в карточке заявки. Если нужно уточнить детали продукта или условия — сформулируйте вопрос конкретнее, либо дождитесь решения банка.";
  return "Я помогу с вопросами о продуктах, документах и этапах рассмотрения заявки. Сформулируйте вопрос подробнее — например: «какие документы нужны» или «как формируется ставка».";
}

// --- bank backoffice ---
app.openapi(createRoute({
  method: "get", path: "/api/bank/queue", operationId: "listBankQueue", tags: ["Bank"], summary: "Очередь заявок банка",
  request: { query: z.object({ status: z.string().optional() }) },
  responses: standardResponses("Очередь заявок"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const status = c.req.valid("query").status;
  const rows = (status
    ? db.prepare("SELECT * FROM applications WHERE status = ? ORDER BY id DESC").all(status)
    : db.prepare("SELECT * FROM applications ORDER BY id DESC").all()) as Row[];
  const enriched = rows.map((a) => {
    const comp = db.prepare("SELECT name, inn, okved_name FROM companies WHERE id = ?").get(a.company_id as number) as Row;
    const client = db.prepare("SELECT name FROM users WHERE id = ?").get(a.client_id as number) as Row;
    return { ...appWithProduct(a), company_name: comp?.name, company_inn: comp?.inn, okved_name: comp?.okved_name, client_name: client?.name };
  });
  return c.json(ok(enriched));
});

app.openapi(createRoute({
  method: "get", path: "/api/bank/applications/{id}", operationId: "getBankDossier", tags: ["Bank"], summary: "Досье заявки для аналитика",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: standardResponses("Досье заявки"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const a = getApplication(c.req.valid("param").id);
  if (!a) return c.json(err("Заявка не найдена"), 404);
  const checks = getApplicationExternalChecks(a.id as number);
  const company = checks.registry?.status === "SUCCESS" && checks.registry.payload
    ? checks.registry.payload
    : db.prepare("SELECT * FROM companies WHERE id = ?").get(a.company_id as number);
  const client = db.prepare("SELECT name FROM users WHERE id = ?").get(a.client_id as number);
  const financialReports = listFinancialReports(a.company_id as number);
  const bki = checks.bki?.status === "SUCCESS" ? checks.bki.payload : null;
  const events = db.prepare("SELECT * FROM application_events WHERE application_id = ? ORDER BY id").all(a.id as number);
  const docs = listDocumentMetadata(a.id as number);
  const externalChecks = {
    registry: checks.registry ? { ...checks.registry, payload: undefined } : null,
    bki: checks.bki ? { ...checks.bki, payload: undefined } : null,
  };
  const currentFinancialReport = financialReportForScoring(a.company_id as number, a.id as number);
  const productEligibility = (db.prepare("SELECT * FROM products ORDER BY id").all() as Row[]).map((product) => {
    const normalizedProduct = productFromRecord(product);
    const result = evaluateProductEligibility(normalizedProduct, {
      amount: Math.min(normalizedProduct.maxAmount, Math.max(normalizedProduct.minAmount, a.amount as number)),
      termMonths: Math.min(normalizedProduct.termMax, Math.max(normalizedProduct.termMin, a.term_months as number)),
      purposeCategory: a.purpose_category as string,
      annualRevenue: currentFinancialReport?.revenue ?? 0,
    });
    return { productId: normalizedProduct.id, eligible: result.eligible, violations: result.violations };
  });
  return c.json(ok({
    ...appWithProduct(a), company, client_name: (client as Row)?.name, financial_reports: financialReports, bki, events, documents: docs,
    external_checks: externalChecks, product_eligibility: productEligibility,
    decision: storedDecision(a.decision),
    score_details: a.score_details ? JSON.parse(a.score_details as string) : null,
    scoring_input: buildScoringInput(a),
  }));
});

const DecisionRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("APPROVE"),
    product_id: z.number().int().positive().optional(),
    rate: z.number().positive(),
    amount: z.number().positive(),
    term_months: z.number().int().positive(),
    reason: z.string().trim().min(3),
  }),
  z.object({
    type: z.literal("CONDITIONS"),
    product_id: z.number().int().positive().optional(),
    rate: z.number().positive(),
    amount: z.number().positive(),
    term_months: z.number().int().positive(),
    reason: z.string().trim().min(3),
  }),
  z.object({
    type: z.literal("MORE_INFO"),
    reason: z.string().trim().min(3),
    request_type: z.enum(MORE_INFO_REQUEST_TYPES),
    required_fields: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    required_files: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
    due_days: z.number().int().min(1).max(30).default(5),
  }),
  z.object({
    type: z.literal("REJECT"),
    rate: z.number().positive().optional(),
    amount: z.number().positive().optional(),
    term_months: z.number().int().positive().optional(),
    reason: z.string().trim().min(3),
  }),
]);

app.openapi(createRoute({
  method: "post", path: "/api/bank/applications/{id}/decision", operationId: "makeBankDecision", tags: ["Bank"],
  summary: "Кредитное решение аналитика (одобрить / изменить условия / отказать / запросить информацию)",
  request: {
    params: z.object({ id: z.coerce.number() }),
    ...jsonBody(DecisionRequestSchema),
  },
  responses: standardResponses("Кредитное решение сохранено"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const applicationId = c.req.valid("param").id;
  const d = c.req.valid("json");
  return idempotentJson(c, {
    userId: u.id,
    operation: `bank:applications:${applicationId}:decision`,
    request: d,
    execute: () => {
      const a = getApplication(applicationId);
      if (!a) throw new CommandValidationError("Заявка не найдена", 404);
      if (!["DECISION", "MORE_INFO"].includes(a.status as string)) throw new CommandValidationError("Заявка не на этапе кредитного решения", 409);
      let selectedProduct: Row | undefined;
      if (d.type === "APPROVE" || d.type === "CONDITIONS") {
        selectedProduct = db.prepare("SELECT * FROM products WHERE id = ?").get(d.product_id ?? a.product_id) as Row | undefined;
        if (!selectedProduct) throw new CommandValidationError("Предлагаемый продукт не найден", 404);
        if (d.amount < (selectedProduct.min_amount as number) || d.amount > (selectedProduct.max_amount as number))
          throw new CommandValidationError(`Сумма альтернативы должна быть от ${fmt(selectedProduct.min_amount as number)} до ${fmt(selectedProduct.max_amount as number)} ₽`, 400);
        if (d.term_months < (selectedProduct.term_min as number) || d.term_months > (selectedProduct.term_max as number))
          throw new CommandValidationError(`Срок альтернативы должен быть от ${selectedProduct.term_min} до ${selectedProduct.term_max} мес.`, 400);
        const rateError = validateDecisionRate(d.rate, selectedProduct.rate_from as number);
        if (rateError) throw new CommandValidationError(rateError, 400);
        const decisionScoringInput = buildScoringInput({ ...a, amount: d.amount });
        const decisionEligibility = evaluateProductEligibility(productFromRecord(selectedProduct), {
          amount: d.amount,
          termMonths: d.term_months,
          purposeCategory: a.purpose_category as string,
          annualRevenue: decisionScoringInput.revenueAnnual,
        });
        if (!decisionEligibility.eligible) throw new CommandValidationError(formatEligibilityError(productFromRecord(selectedProduct), decisionEligibility), 400);
        if (d.type === "APPROVE" && (selectedProduct.id !== a.product_id || d.amount !== a.amount || d.term_months !== a.term_months))
          throw new CommandValidationError("Другой продукт, сумма или срок оформляются как изменение условий", 400);
      }
      const dueAt = d.type === "MORE_INFO" ? new Date(Date.now() + d.due_days * 24 * 60 * 60 * 1000).toISOString() : undefined;
      const requiredFields = d.type === "MORE_INFO"
        ? d.request_type === "FINANCIALS" ? ["year", "revenue", "profit", "own_capital", "monthly_obligations"]
          : d.request_type === "COMMENT" ? ["comment"]
          : d.request_type === "BKI_CONSENT" ? ["consent"]
          : d.required_fields
        : [];
      if (d.type === "MORE_INFO" && d.request_type === "DOCUMENT" && d.required_files.length === 0) {
        throw new CommandValidationError("Укажите хотя бы один обязательный документ", 400);
      }
      if (d.type === "MORE_INFO" && d.request_type === "COMPANY_DATA" && requiredFields.length === 0) {
        throw new CommandValidationError("Укажите обязательные поля компании", 400);
      }
      applyDecision(applicationId, {
        type: d.type,
        rate: "rate" in d ? d.rate ?? null : null,
        amount: "amount" in d ? d.amount ?? null : null,
        termMonths: "term_months" in d ? d.term_months ?? null : null,
        reason: d.reason,
        productId: selectedProduct?.id as number | undefined,
        productName: selectedProduct?.name as string | undefined,
      }, u.name, u.id, d.type === "MORE_INFO" ? {
        type: d.request_type,
        reason: d.reason,
        requiredFields,
        requiredFiles: d.required_files,
        dueAt,
      } : undefined);
      return appWithProduct(getApplication(applicationId) as Row);
    },
  });
});

app.openapi(createRoute({
  method: "post", path: "/api/bank/applications/{id}/issue", operationId: "issueApplication", tags: ["Bank"],
  summary: "Идемпотентно подтвердить модельную выдачу после подписания клиентом",
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: standardResponses("Модельная выдача зафиксирована"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только сотрудник банка может подтвердить выдачу"), 403);
  const applicationId = c.req.valid("param").id;
  return idempotentJson(c, {
    userId: u.id,
    operation: `bank:applications:${applicationId}:issue`,
    request: {},
    execute: () => {
      try {
        issueApplication(applicationId, u.id as number, u.name as string);
        return appWithProduct(getApplication(applicationId) as Row);
      } catch (error) {
        throw new CommandValidationError(error instanceof Error ? error.message : "Не удалось подтвердить выдачу", 409);
      }
    },
  });
});

app.openapi(createRoute({
  method: "post", path: "/api/bank/applications/{id}/financial-reports/{reportId}/review", operationId: "reviewFinancialReport", tags: ["Bank"],
  summary: "Подтвердить или отклонить финансовую отчётность клиента",
  request: {
    params: z.object({ id: z.coerce.number().int().positive(), reportId: z.coerce.number().int().positive() }),
    ...jsonBody(z.discriminatedUnion("action", [
      z.object({ action: z.literal("VERIFY") }),
      z.object({ action: z.literal("REJECT"), reason: z.string().trim().min(3).max(1000) }),
    ])),
  },
  responses: standardResponses("Статус отчётности обновлён"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const { id, reportId } = c.req.valid("param");
  const input = c.req.valid("json");
  try {
    const report = reviewFinancialReport(
      id,
      reportId,
      input.action,
      u.id as number,
      u.name as string,
      input.action === "REJECT" ? input.reason : undefined,
    );
    return c.json(ok(report));
  } catch (error) {
    return c.json(err(error instanceof Error ? error.message : "Не удалось проверить отчётность"), 409);
  }
});

app.openapi(createRoute({
  method: "post", path: "/api/bank/applications/{id}/more-info/retry", operationId: "retryExternalChecks", tags: ["Bank"],
  summary: "Повторить внешние проверки по системному запросу без действия клиента",
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: standardResponses("Повторная проверка запущена"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const applicationId = c.req.valid("param").id;
  const a = getApplication(applicationId);
  if (!a) return c.json(err("Заявка не найдена"), 404);
  const request = getActiveMoreInfoRequest(applicationId);
  if (!request || request.type !== "SYSTEM_RETRY") return c.json(err("Нет системной проверки, ожидающей повтора"), 409);
  try {
    retrySystemMoreInfo(applicationId, u.id as number, u.name as string);
    return c.json(ok(appWithProduct(getApplication(applicationId) as Row)));
  } catch (error) {
    return c.json(err(error instanceof Error ? error.message : "Не удалось повторить проверку"), 409);
  }
});

app.openapi(createRoute({
  method: "get", path: "/api/bank/applications/{id}/recommendation", operationId: "getRecommendation", tags: ["Bank"],
  summary: "Рекомендация конвейера по скорингу (proposeDecision)",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: standardResponses("Сохранённая рекомендация"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const a = getApplication(c.req.valid("param").id);
  if (!a) return c.json(err("Заявка не найдена"), 404);
  const recommendation = getStoredRecommendation(a.id as number);
  if (!recommendation) return c.json(err("Сохранённая рекомендация ещё не сформирована"), 409);
  return c.json(ok({
    scorecardVersion: recommendation.scorecardVersion,
    score: recommendation.score,
    grade: recommendation.grade,
    factors: recommendation.factors,
    proposal: recommendation.proposal,
    calculatedAt: recommendation.calculatedAt,
    supersededAt: recommendation.supersededAt,
    supersededByRequestId: recommendation.supersededByRequestId,
    financialReport: recommendation.financialReport,
  }));
});

app.openapi(createRoute({
  method: "get", path: "/api/bank/applications/{id}/summary", operationId: "getDossierSummary", tags: ["Bank", "Assistant"],
  summary: "Шаблонное саммари досье для аналитика",
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: standardResponses("Саммари досье"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const a = getApplication(c.req.valid("param").id);
  if (!a) return c.json(err("Заявка не найдена"), 404);
  const score = getStoredRecommendation(a.id as number);
  const checks = getApplicationExternalChecks(a.id as number);
  const comp = (checks.registry?.status === "SUCCESS" && checks.registry.payload
    ? checks.registry.payload
    : db.prepare("SELECT * FROM companies WHERE id = ?").get(a.company_id as number)) as Row;
  const bki = (checks.bki?.status === "SUCCESS" ? checks.bki.payload : null) as Row | null;
  const facts = [
    `Компания: ${comp.name} (${comp.form}, ИНН ${comp.inn}), ОКВЭД ${comp.okved_code} — ${comp.okved_name}.`,
    `Запрос: ${fmt(a.amount as number)} ₽ на ${a.term_months} мес., цель: ${a.purpose}.`,
    score ? `Скоринг: ${score.score} баллов, класс ${score.grade}.` : "",
    bki ? `БКИ: score ${bki.bki_score}, активных кредитов ${bki.active_credits}, просрочек ${bki.overdue_count} (макс. ${bki.worst_delay_days} дн.), ежемесячный платёж ${fmt(bki.monthly_payment as number)} ₽.` : "",
    score ? "Факторы: " + score.factors.map((f) => `${f.label}: ${f.value} (${f.points > 0 ? "+" : ""}${f.points})`).join("; ") + "." : "",
  ].filter(Boolean).join("\n");
  const text = facts + "\n\nРекомендация: сверить факторы с внутренними лимитами и принять решение; при классе C рассмотреть снижение суммы или срока.";
  return c.json(ok({ text, source: "template" as const }));
});

// --- mocks: воспроизведённые внешние интеграции (см. THIRD_PARTY_NOTICES) ---
app.openapi(createRoute({
  method: "get", path: "/api/mocks/bki/{inn}", operationId: "getMockCreditHistory", tags: ["Mocks"],
  summary: "Мок бюро кредитных историй (смоделированная интеграция)",
  request: { params: z.object({ inn: z.string() }) },
  responses: standardResponses("Синтетический отчёт БКИ"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const result = localCreditBureauProvider.checkByInn(c.req.valid("param").inn);
  if (result.status === "NOT_FOUND") return c.json(err("Субъект или кредитная история не найдены"), 404);
  return c.json(ok({
    source: result.provider,
    provider_version: result.providerVersion,
    requested_at: result.requestedAt,
    inn: result.subjectKey,
    report: result.payload,
  }));
});

app.openapi(createRoute({
  method: "get", path: "/api/mocks/egrul/{inn}", operationId: "getMockBusinessRegistry", tags: ["Mocks"],
  summary: "Мок ЕГРЮЛ/ЕГРИП (смоделированная интеграция)",
  request: { params: z.object({ inn: z.string() }) },
  responses: standardResponses("Синтетическая запись реестра"),
}), (c) => {
  const u = requireUser(c); if (!u) return c.json(err("Не авторизован"), 401);
  if (u.role !== "BANK") return c.json(err("Только для сотрудников банка"), 403);
  const result = localBusinessRegistryProvider.checkByInn(c.req.valid("param").inn);
  if (result.status === "NOT_FOUND") return c.json(err("Субъект не найден"), 404);
  return c.json(ok({
    source: result.provider,
    provider_version: result.providerVersion,
    requested_at: result.requestedAt,
    registry_entry: result.payload,
  }));
});

// --- OpenAPI / Swagger ---
app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Умный кредитный кабинет — API",
    version: "1.0.1",
    description: "Демонстрационный кредитный конвейер для МСБ. Использует синтетические данные, локальные моки внешних систем и шаблонные ответы ассистента.",
  },
  security: [{ cookieAuth: [] }],
});
app.get("/api/docs", apiReference({
  url: "/openapi.json",
  cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.75.1",
}));

// --- статика фронтенда (production) ---
const dist = path.join(process.cwd(), "dist");
if (fs.existsSync(dist)) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", (c) => c.html(fs.readFileSync(path.join(dist, "index.html"), "utf8")));
}

export { app };
