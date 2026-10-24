// Клиент API: типы и обёртка над fetch (сессия — httpOnly cookie)

export interface User {
  id: number; login: string; name: string; role: "CLIENT" | "BANK";
  company_id: number | null; position: string | null;
}

export interface Product {
  id: number; code: string; name: string; tagline: string; description: string;
  min_amount: number; max_amount: number; rate_from: number;
  term_min: number; term_max: number; purpose_tags: string; features: string; min_revenue: number;
}

export interface Application {
  id: number; public_no: string; product_id: number; company_id: number;
  amount: number; term_months: number; purpose: string; purpose_category: string;
  status: string; status_label?: string; product_name?: string; product_rate_from?: number;
  score: number | null; grade: string | null; scorecard_version?: string | null; created_at: string; updated_at: string;
  decision?: Decision | null; score_details?: ScoreFactor[] | null;
  preliminaryTerms?: CreditTerms | null;
  client_comment?: string | null;
  preapproval?: { status: "PREAPPROVED" | "REVIEW"; label: string; description: string } | null;
  more_info_requests?: MoreInfoRequest[];
  active_more_info_request?: MoreInfoRequest | null;
  signed_at?: string | null;
  signed_by?: number | null;
  issued_at?: string | null;
  issued_by?: number | null;
  issuance_mode?: "LEGACY_COMBINED" | "BANK_CONFIRMED" | null;
}

export type DecisionType = "APPROVE" | "CONDITIONS" | "MORE_INFO" | "REJECT";

export interface CreditTerms {
  productId?: number | null;
  productName?: string | null;
  rate?: number | null;
  amount?: number | null;
  termMonths?: number | null;
  monthlyPayment?: number | null;
  overpayment?: number | null;
  totalPayment?: number | null;
  paymentType?: string | null;
  validUntil?: string | null;
  feesIncluded?: boolean | null;
}

export interface Decision extends CreditTerms {
  type: DecisionType;
  reason: string | null;
  decidedAt: string | null;
  finalRiskAssessment?: {
    scorecardVersion: string;
    score: number;
    grade: "A" | "B" | "C" | "D";
    factors: ScoreFactor[];
    assessedAmount: number;
    productId: number;
    productName: string;
    calculatedAt: string;
  };
}

export type DecisionProposal = Omit<Decision, "decidedAt">;

export interface ScoreFactor { key: string; label: string; value: string; points: number; explanation: string; }

export interface CalculatorScenario {
  bki_score: number;
  pdn: number;
  margin_percent: number;
}

export interface CalculatorRequest {
  amount: number;
  term_months: number;
  purpose_category: string;
  product_id?: number;
  scenario?: CalculatorScenario;
}

export interface CalculatorPublicFactor {
  key: string;
  label: string;
  value: string;
  impact: "positive" | "negative" | "neutral" | number | string;
  explanation: string;
}

export interface CalculatorRecommendation {
  kind: string;
  title: string;
  description: string;
  suggestedAmount?: number;
  mode?: "ADVISORY_ONLY";
  comparison?: { status: "NOT_CALCULATED" };
  requiredData?: string[];
}

export type CompatibilityLevel = "HIGH" | "MEDIUM" | "MANUAL_REVIEW";

export interface CalculatorMetrics {
  compatibilityIndex: number;
  compatibilityLevel: CompatibilityLevel;
  rate: number;
  monthlyPayment: number;
  overpayment: number;
  totalPayment: number;
  creditPotential: number;
  revenueGrowth: number | null;
  margin: number | null;
  publicFactors: CalculatorPublicFactor[];
  recommendations: CalculatorRecommendation[];
}

export interface CalculatorProductOption {
  product: {
    id: number; code: string; name: string; tagline: string;
    minAmount: number; maxAmount: number; rateFrom: number;
    termMin: number; termMax: number; purposeTags: string[]; minRevenue: number;
  };
  amount: number;
  termMonths: number;
  exactMatch: boolean;
  reasons: string[];
  economics: Pick<CalculatorMetrics, "compatibilityIndex" | "compatibilityLevel" | "rate" | "monthlyPayment" | "overpayment" | "totalPayment">;
}

export type CalculationSelectionSource = "SYSTEM_RECOMMENDED" | "CLIENT_SELECTED" | "CLIENT_ALTERNATIVE";

export interface CalculatorResponse {
  calculation_id: number;
  selection: {
    requested: { amount: number; termMonths: number; purposeCategory: string };
    recommended: CalculatorProductOption;
    alternatives: CalculatorProductOption[];
  };
  current: CalculatorMetrics;
  scenario: CalculatorMetrics | null;
  disclaimer: string;
  methodology: string;
}

export interface SavedCalculation {
  calculation_id: number;
  selection_source: CalculationSelectionSource;
  application: { id: number; public_no: string; status: string } | null;
  product: Product;
  amount: number;
  term_months: number;
  purpose_category: string;
  requested_amount: number;
  requested_term_months: number;
  created_at: string;
}

export interface CreateApplicationInput {
  purpose: string;
  calculation_id: number;
}

export interface ProvideFinancialsInput {
  year: number;
  revenue: number;
  profit: number;
  own_capital: number;
  monthly_obligations: number;
  comment: string;
}

export type MoreInfoRequestType = "FINANCIALS" | "DOCUMENT" | "COMMENT" | "BKI_CONSENT" | "COMPANY_DATA" | "SYSTEM_RETRY";
export type MoreInfoRequestStatus = "WAITING_CLIENT" | "CLIENT_RESPONDED" | "RECHECK" | "CLOSED" | "CANCELLED";

export interface MoreInfoResponse {
  id: number;
  requestId: number;
  applicationId: number;
  responseType: string;
  payload: Record<string, unknown>;
  source: "CLIENT" | "SYSTEM" | "BANK";
  submittedBy: number | null;
  createdAt: string;
}

export interface MoreInfoRequest {
  id: number;
  applicationId: number;
  type: MoreInfoRequestType;
  reason: string;
  requiredFields: string[];
  requiredFiles: string[];
  dueAt: string;
  status: MoreInfoRequestStatus;
  source: "SYSTEM" | "BANK";
  requestedBy: number | null;
  createdAt: string;
  respondedAt: string | null;
  closedAt: string | null;
  response: MoreInfoResponse | null;
}

export interface MoreInfoResponseInput {
  comment?: string;
  financials?: ProvideFinancialsInput;
  files?: Array<{ name: string; size: number; type: string }>;
  consent?: boolean;
  company_data?: Record<string, string>;
}

export type BankDecisionInput =
  | { type: "APPROVE" | "CONDITIONS"; product_id?: number; rate: number; amount: number; term_months: number; reason: string }
  | { type: "REJECT"; reason: string }
  | {
      type: "MORE_INFO";
      reason: string;
      request_type: MoreInfoRequestType;
      required_fields: string[];
      required_files: string[];
      due_days: number;
    };

export interface AppEvent { id: number; from_status: string | null; to_status: string; actor: string; comment: string | null; created_at: string; }
export interface AppDocument {
  id: number;
  application_id: number;
  kind: string;
  filename: string;
  status: string;
  document_version: string | null;
  content_hash: string | null;
  opened_at: string | null;
  opened_by: number | null;
  acknowledged_at: string | null;
  acknowledged_by: number | null;
  signed_at: string | null;
  signed_by: number | null;
  created_at: string;
}
export interface ChatMessage { id: number; role: "user" | "assistant"; content: string; source: "user" | "template"; created_at: string; }

export interface NewsItem { id: number; title: string; body: string; tags: string; published_at: string; personalized: boolean; }

export interface Company {
  id: number; name: string; form: string; inn: string; ogrn: string;
  okved_code: string; okved_name: string; reg_date: string; address: string; head_name: string;
  segment: string;
}

export interface Financials {
  id: number; year: number; revenue: number; profit: number;
  own_capital: number; monthly_obligations: number;
  status: "SUBMITTED" | "VERIFIED" | "REJECTED";
  source: "CLIENT" | "BANK" | "DEMO_SEED" | "LEGACY";
  submitted_at: string;
  verified_at: string | null;
}

export interface FinancialReport {
  id: number;
  companyId: number;
  applicationId: number | null;
  year: number;
  revenue: number;
  profit: number;
  ownCapital: number;
  monthlyObligations: number;
  status: "SUBMITTED" | "VERIFIED" | "REJECTED";
  source: "CLIENT" | "BANK" | "DEMO_SEED" | "LEGACY";
  submittedBy: number | null;
  verifiedBy: number | null;
  submittedAt: string;
  verifiedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

export interface CreditHistory {
  bki_score: number; active_credits: number; total_debt: number;
  overdue_count: number; worst_delay_days: number; monthly_payment: number;
  updated_at?: string;
}

export interface BenefitSuggestion {
  id: string;
  title: string;
  category: string;
  status: "POSSIBLE_DIRECTION";
  verificationStatus: "REQUIRES_CHECK";
  demo: true;
  program: null;
  description: string;
  benefit: string;
  whyMatches: string[];
  requirements: string[];
}

export interface ClientProfile {
  user: User;
  company: Company;
  financials: Financials[];
  credit_history: CreditHistory | null;
  indicators: {
    business_age_years: number;
    revenue_growth_percent: number | null;
    margin_percent: number | null;
    pdn_percent: number | null;
  };
  benefits: BenefitSuggestion[];
  benefits_metadata: {
    mode: "DEMO_DIRECTIONS";
    methodology: "DETERMINISTIC_RULES";
    catalogVersion: string;
    externalDataUsed: false;
    aiUsed: false;
    eligibilityChecked: false;
  };
  benefits_disclaimer: string;
}

export interface ExternalCheckMetadata {
  id: number;
  application_id: number;
  kind: "BKI" | "BUSINESS_REGISTRY";
  provider: string;
  provider_version: string;
  status: "SUCCESS" | "NOT_FOUND" | "ERROR";
  subject_key: string;
  requested_at: string;
}

export interface Dossier extends Application {
  company: Company;
  client_name: string;
  financial_reports: FinancialReport[];
  bki: CreditHistory | null;
  external_checks: {
    registry: ExternalCheckMetadata | null;
    bki: ExternalCheckMetadata | null;
  };
  product_eligibility: Array<{
    productId: number;
    eligible: boolean;
    violations: Array<{ code: string; message: string }>;
  }>;
  events: AppEvent[];
  documents: AppDocument[];
}

export interface Recommendation {
  scorecardVersion: string;
  calculatedAt: string;
  score: number;
  grade: string;
  factors: ScoreFactor[];
  proposal: DecisionProposal;
  supersededAt: string | null;
  supersededByRequestId: number | null;
  financialReport: FinancialReport | null;
}

export type ApiFailureKind = "confirmed" | "unknown";

export class ApiRequestError extends Error {
  readonly kind: ApiFailureKind;
  readonly status?: number;

  constructor(message: string, kind: ApiFailureKind, status?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.kind = kind;
    this.status = status;
  }
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

function apiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  const envelope = value as Record<string, unknown>;
  return envelope.ok === true || (envelope.ok === false && typeof envelope.error === "string");
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers,
      signal: controller.signal,
    });
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new ApiRequestError("Сервер вернул повреждённый ответ. Результат команды нужно проверить.", "unknown", res.status);
    }

    if (!apiEnvelope<T>(payload)) {
      throw new ApiRequestError("Сервер вернул ответ неизвестного формата. Результат команды нужно проверить.", "unknown", res.status);
    }
    if (!res.ok || payload.ok === false) {
      const message = payload.ok === false ? payload.error : `Ошибка ${res.status}`;
      const kind: ApiFailureKind = res.status >= 400 && res.status < 500 && payload.ok === false ? "confirmed" : "unknown";
      throw new ApiRequestError(message || `Ошибка ${res.status}`, kind, res.status);
    }
    return payload.data;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError("Сервер не ответил вовремя. Результат команды нужно проверить перед повтором.", "unknown");
    }
    throw new ApiRequestError(
      error instanceof Error && error.message ? `Ошибка сети: ${error.message}` : "Ошибка сети. Результат команды неизвестен.",
      "unknown",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  me: () => req<User | null>("/api/auth/me"),
  login: (login: string, password: string) =>
    req<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ login, password }) }),
  logout: () => req<null>("/api/auth/logout", { method: "POST" }),

  products: () => req<Product[]>("/api/products"),
  product: (id: number) => req<Product>(`/api/products/${id}`),
  clientProfile: () => req<ClientProfile>("/api/client/profile"),

  evaluateCalculator: (b: CalculatorRequest) =>
    req<CalculatorResponse>("/api/calculator/evaluate", { method: "POST", body: JSON.stringify(b) }),
  savedCalculation: (id: number) => req<SavedCalculation>(`/api/calculator/runs/${id}`),

  createApplication: (b: CreateApplicationInput, idempotencyKey: string) =>
    req<{ id: number; public_no: string; created: boolean }>("/api/applications", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(b) }),
  myApplications: () => req<Application[]>("/api/applications/mine"),
  application: (id: number) => req<Application & { events: AppEvent[]; documents: AppDocument[]; chat: ChatMessage[] }>(`/api/applications/${id}`),
  accept: (id: number, idempotencyKey: string) => req<unknown>(`/api/applications/${id}/accept`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey } }),
  acknowledgeDocuments: (id: number, idempotencyKey: string) => req<{ documents: AppDocument[] }>(`/api/applications/${id}/documents/acknowledge`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey } }),
  sign: (id: number, idempotencyKey: string) => req<unknown>(`/api/applications/${id}/sign`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey } }),
  decline: (id: number, idempotencyKey: string) => req<unknown>(`/api/applications/${id}/decline`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey } }),
  respond: (id: number, comment: string) => req<unknown>(`/api/applications/${id}/respond`, { method: "POST", body: JSON.stringify({ comment }) }),
  provideFinancials: (id: number, financials: ProvideFinancialsInput) =>
    req<unknown>(`/api/applications/${id}/financials`, { method: "POST", body: JSON.stringify(financials) }),
  respondMoreInfo: (id: number, requestId: number, response: MoreInfoResponseInput) =>
    req<unknown>(`/api/applications/${id}/more-info/${requestId}/response`, { method: "POST", body: JSON.stringify(response) }),

  news: () => req<NewsItem[]>("/api/news"),
  askAssistant: (message: string, application_id?: number) =>
    req<{ text: string; source: "template" }>("/api/assistant", { method: "POST", body: JSON.stringify({ message, application_id }) }),

  queue: (status?: string) => req<(Application & { company_name?: string; company_inn?: string; okved_name?: string; client_name?: string })[]>("/api/bank/queue" + (status ? `?status=${status}` : "")),
  dossier: (id: number) => req<Dossier>(`/api/bank/applications/${id}`),
  decide: (id: number, d: BankDecisionInput, idempotencyKey: string) =>
    req<unknown>(`/api/bank/applications/${id}/decision`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(d) }),
  issueApplication: (id: number, idempotencyKey: string) => req<unknown>(`/api/bank/applications/${id}/issue`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey } }),
  reviewFinancialReport: (id: number, reportId: number, input: { action: "VERIFY" } | { action: "REJECT"; reason: string }) =>
    req<FinancialReport>(`/api/bank/applications/${id}/financial-reports/${reportId}/review`, { method: "POST", body: JSON.stringify(input) }),
  retryMoreInfo: (id: number, idempotencyKey: string) => req<unknown>(`/api/bank/applications/${id}/more-info/retry`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey } }),
  recommendation: (id: number) => req<Recommendation>(`/api/bank/applications/${id}/recommendation`),
  summary: (id: number) => req<{ text: string; source: string }>(`/api/bank/applications/${id}/summary`),
  documentDownloadUrl: (id: number) => `/api/documents/${id}/download`,
};

const MONEY_FORMATTER = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMoney(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? MONEY_FORMATTER.format(n) : "Не указано";
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: "bg-blue-100 text-blue-800",
  DATA_CHECK: "bg-amber-100 text-amber-800",
  ENRICHMENT: "bg-amber-100 text-amber-800",
  SCORING: "bg-purple-100 text-purple-800",
  DECISION: "bg-purple-100 text-purple-800",
  MORE_INFO: "bg-orange-100 text-orange-800",
  OFFER: "bg-green-100 text-green-800",
  DOCUMENTS: "bg-green-100 text-green-800",
  SIGNING: "bg-green-100 text-green-800",
  READY_FOR_ISSUANCE: "bg-cyan-100 text-cyan-900",
  ISSUED: "bg-emerald-700 text-white",
  REJECTED: "bg-red-100 text-red-800",
  DECLINED_BY_CLIENT: "bg-gray-200 text-gray-700",
};
