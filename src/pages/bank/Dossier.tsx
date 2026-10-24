import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, fmtDate, fmtMoney, type BankDecisionInput, type DecisionType, type Dossier as DossierData, type MoreInfoRequestStatus, type MoreInfoRequestType, type MoreInfoResponse, type Product, type Recommendation } from "@/lib/api";
import { clearMutationKey, getMutationKey, recoverMutationOutcome } from "@/lib/mutation-recovery";
import {
  ECONOMICS_DISCLOSURE,
  creditTermsSnapshotError,
  paymentTypeLabel,
  resolveCreditTerms,
  validUntilLabel,
} from "@/lib/credit-terms";
import { EventLog, GradeBadge, ScoreCard, StatusBadge } from "@/components/widgets";
import ConfirmDialog from "@/components/ConfirmDialog";
import { AlertCircle, ArrowLeft, Banknote, Bot, Download, Landmark, Loader2, RefreshCw, Shuffle } from "lucide-react";

interface DecisionForm {
  type: DecisionType;
  product_id: string;
  rate: string;
  amount: string;
  term_months: string;
  reason: string;
  request_type: MoreInfoRequestType;
  required_fields: string;
  required_files: string;
  due_days: string;
}

const DECISION_LABELS: Record<DecisionType, string> = {
  APPROVE: "Одобрено",
  CONDITIONS: "Изменены условия",
  MORE_INFO: "Запрошена информация",
  REJECT: "Отказ",
};

const hasCreditTerms = (type: DecisionType) => type === "APPROVE" || type === "CONDITIONS";
const MORE_INFO_TYPE_LABELS: Record<MoreInfoRequestType, string> = {
  FINANCIALS: "Финансовая отчётность",
  DOCUMENT: "Документы",
  COMMENT: "Пояснение клиента",
  BKI_CONSENT: "Согласие на запрос БКИ",
  COMPANY_DATA: "Сведения о компании",
  SYSTEM_RETRY: "Повтор внешней проверки банком",
};
const FINANCIAL_STATUS_LABELS = {
  SUBMITTED: "Ожидает проверки",
  VERIFIED: "Подтверждена банком",
  REJECTED: "Отклонена",
} as const;
const FINANCIAL_SOURCE_LABELS = {
  CLIENT: "Клиент",
  BANK: "Банк",
  DEMO_SEED: "Синтетический demo-набор",
  LEGACY: "Legacy-данные",
} as const;
const MORE_INFO_STATUS_LABELS: Record<MoreInfoRequestStatus, string> = {
  WAITING_CLIENT: "Ожидает ответа клиента",
  CLIENT_RESPONDED: "Ответ клиента получен",
  RECHECK: "Выполняется повторная проверка",
  CLOSED: "Закрыт",
  CANCELLED: "Отменён",
};
const MORE_INFO_SOURCE_LABELS = {
  CLIENT: "Клиент",
  SYSTEM: "Система",
  BANK: "Сотрудник банка",
} as const;
const COMPANY_DATA_FIELD_LABELS: Record<string, string> = {
  address: "Адрес",
  head_name: "Руководитель",
  okved_code: "Код ОКВЭД",
  okved_name: "Вид деятельности",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function responseValue(value: unknown) {
  if (typeof value === "number") return value.toLocaleString("ru-RU");
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return typeof value === "string" && value.trim() ? value : "Не указано";
}

function MoreInfoResponseDetails({ response }: { response: MoreInfoResponse }) {
  const payload = response.payload;
  const financials = asRecord(payload.financials);
  const companyData = asRecord(payload.companyData);
  const files = Array.isArray(payload.files) ? payload.files.map(asRecord).filter((file): file is Record<string, unknown> => Boolean(file)) : [];
  const comment = typeof payload.comment === "string" && payload.comment.trim() ? payload.comment : null;
  const hasKnownContent = Boolean(financials || companyData || files.length || comment || payload.consent === true || payload.action === "manual_retry");

  return (
    <div className="mt-2 space-y-3">
      {comment && <div><p className="font-medium text-foreground">Комментарий</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{comment}</p></div>}
      {files.length > 0 && (
        <div>
          <p className="font-medium text-foreground">Переданные файлы</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {files.map((file, index) => <li key={`${String(file.name)}-${index}`}>• {responseValue(file.name)}{typeof file.size === "number" ? ` · ${file.size.toLocaleString("ru-RU")} Б` : ""}{typeof file.type === "string" && file.type ? ` · ${file.type}` : ""}</li>)}
          </ul>
        </div>
      )}
      {financials && (
        <div>
          <p className="font-medium text-foreground">Финансовые показатели</p>
          <dl className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
            <div><dt className="inline">Год: </dt><dd className="inline font-medium text-foreground">{responseValue(financials.year)}</dd></div>
            <div><dt className="inline">Выручка: </dt><dd className="inline font-medium text-foreground">{typeof financials.revenue === "number" ? fmtMoney(financials.revenue) : responseValue(financials.revenue)}</dd></div>
            <div><dt className="inline">Прибыль: </dt><dd className="inline font-medium text-foreground">{typeof financials.profit === "number" ? fmtMoney(financials.profit) : responseValue(financials.profit)}</dd></div>
            <div><dt className="inline">Собственный капитал: </dt><dd className="inline font-medium text-foreground">{typeof financials.own_capital === "number" ? fmtMoney(financials.own_capital) : responseValue(financials.own_capital)}</dd></div>
            <div className="sm:col-span-2"><dt className="inline">Ежемесячные обязательства: </dt><dd className="inline font-medium text-foreground">{typeof financials.monthly_obligations === "number" ? fmtMoney(financials.monthly_obligations) : responseValue(financials.monthly_obligations)}</dd></div>
          </dl>
        </div>
      )}
      {companyData && (
        <div>
          <p className="font-medium text-foreground">Обновлённые сведения о компании</p>
          <dl className="mt-1 space-y-1 text-muted-foreground">
            {Object.entries(companyData).map(([field, value]) => <div key={field}><dt className="inline">{COMPANY_DATA_FIELD_LABELS[field] || field}: </dt><dd className="inline font-medium text-foreground">{responseValue(value)}</dd></div>)}
          </dl>
        </div>
      )}
      {payload.consent === true && <p className="font-medium text-foreground">Согласие на запрос кредитной истории подтверждено.</p>}
      {payload.action === "manual_retry" && <p className="font-medium text-foreground">Сотрудник банка запустил повторную внешнюю проверку.</p>}
      {!hasKnownContent && <p className="text-muted-foreground">Ответ сохранён без отдельных отображаемых полей.</p>}
      <details className="rounded-lg border bg-white p-2 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Технические сведения</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </div>
  );
}

const EMPTY_DECISION: DecisionForm = {
  type: "APPROVE", product_id: "", rate: "", amount: "", term_months: "", reason: "",
  request_type: "FINANCIALS", required_fields: "", required_files: "", due_days: "5",
};

function fillMissingCreditTerms(current: DecisionForm, dossier: DossierData, products: Product[]): DecisionForm {
  const productId = current.product_id || String(dossier.product_id);
  const product = products.find((item) => String(item.id) === productId);
  return {
    ...current,
    product_id: productId,
    rate: current.rate || (product ? String(product.rate_from) : ""),
    amount: current.amount || String(dossier.amount),
    term_months: current.term_months || String(dossier.term_months),
  };
}

function selectDecisionType(current: DecisionForm, type: DecisionType, dossier: DossierData, products: Product[]): DecisionForm {
  if (!hasCreditTerms(type)) return { ...current, type };
  const product = products.find((item) => item.id === dossier.product_id);
  return {
    ...current,
    type,
    product_id: String(dossier.product_id),
    rate: product ? String(product.rate_from) : "",
    amount: String(dossier.amount),
    term_months: String(dossier.term_months),
  };
}

type UnresolvedBankCommand =
  | { kind: "decision"; decisionType: DecisionType }
  | { kind: "issue" }
  | { kind: "retry"; requestId: number };

function decisionApplied(type: DecisionType, dossier: DossierData): boolean {
  if (type === "REJECT") return dossier.status === "REJECTED";
  if (type === "MORE_INFO") return dossier.status === "MORE_INFO";
  return dossier.status === "OFFER";
}

function issuanceApplied(dossier: DossierData): boolean {
  return dossier.status === "ISSUED" && Boolean(dossier.issued_at) && dossier.issuance_mode === "BANK_CONFIRMED";
}

function externalRetryApplied(requestId: number, dossier: DossierData): boolean {
  return dossier.active_more_info_request?.id !== requestId;
}

function validateCreditTerms(decision: DecisionForm, product: Product | undefined, productsBusy: boolean): string {
  if (productsBusy) return "Дождитесь загрузки продукта и его ограничений.";
  if (!decision.product_id || !product) return "Выберите доступный продукт.";

  const rate = Number(decision.rate);
  if (!decision.rate.trim() || !Number.isFinite(rate)) return "Укажите ставку.";
  if (rate < product.rate_from) return `Ставка не может быть ниже ${product.rate_from}%.`;

  const amount = Number(decision.amount);
  if (!decision.amount.trim() || !Number.isFinite(amount)) return "Укажите сумму.";
  if (amount < product.min_amount || amount > product.max_amount) return `Сумма должна быть от ${fmtMoney(product.min_amount)} до ${fmtMoney(product.max_amount)}.`;

  const term = Number(decision.term_months);
  if (!decision.term_months.trim() || !Number.isInteger(term)) return "Укажите срок целым числом месяцев.";
  if (term < product.term_min || term > product.term_max) return `Срок должен быть от ${product.term_min} до ${product.term_max} мес.`;

  return "";
}

export default function Dossier() {
  const { id } = useParams();
  const [d, setD] = useState<DossierData | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [summary, setSummary] = useState<{ text: string; source: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [decision, setDecision] = useState<DecisionForm>(EMPTY_DECISION);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsBusy, setProductsBusy] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const [dossierBusy, setDossierBusy] = useState(true);
  const [dossierError, setDossierError] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issuanceOpen, setIssuanceOpen] = useState(false);
  const [issuanceError, setIssuanceError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [unresolvedCommand, setUnresolvedCommand] = useState<UnresolvedBankCommand | null>(null);
  const [reportReview, setReportReview] = useState<{ reportId: number; action: "VERIFY" | "REJECT" } | null>(null);
  const [reportReviewReason, setReportReviewReason] = useState("");
  const [reportReviewError, setReportReviewError] = useState("");
  const dossierRef = useRef<DossierData | null>(null);
  const productsRef = useRef<Product[]>([]);

  const load = useCallback(async () => {
    await Promise.resolve();
    setDossierBusy(true);
    setDossierError("");
    try {
      const dossier = await api.dossier(Number(id));
      dossierRef.current = dossier;
      setD(dossier);
      setDecision((current) => fillMissingCreditTerms(current, dossier, productsRef.current));
      setDossierError("");
      return dossier;
    } catch (reason) {
      setDossierError(reason instanceof Error ? reason.message : "Не удалось загрузить досье");
      return null;
    } finally {
      setDossierBusy(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const loadProducts = useCallback(async () => {
    await Promise.resolve();
    setProductsBusy(true);
    setProductsError("");
    try {
      const availableProducts = await api.products();
      productsRef.current = availableProducts;
      setProducts(availableProducts);
      if (dossierRef.current) {
        setDecision((current) => fillMissingCreditTerms(current, dossierRef.current!, availableProducts));
      }
      setProductsError("");
    } catch (reason) {
      setProductsError(reason instanceof Error ? reason.message : "Не удалось загрузить продукты");
    } finally {
      setProductsBusy(false);
    }
  }, []);
  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const loadRecommendation = useCallback(async () => {
    await Promise.resolve();
    setRecommendationBusy(true);
    setRecommendationError("");
    try {
      setRec(await api.recommendation(Number(id)));
      setRecommendationError("");
    } catch (reason) {
      setRecommendationError(reason instanceof Error ? reason.message : "Не удалось загрузить рекомендацию");
    } finally {
      setRecommendationBusy(false);
    }
  }, [id]);

  const dossierStatus = d?.status;
  useEffect(() => {
    if (dossierStatus === "DECISION") {
      void loadRecommendation();
    } else {
      setRec(null);
      setRecommendationError("");
    }
  }, [dossierStatus, loadRecommendation]);

  if (!d && dossierBusy) return <div className="min-h-screen flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка досье…</div>;
  if (!d) return (
    <div className="min-h-screen bg-neutral-50 p-4 flex items-center justify-center">
      <Card className="w-full max-w-lg border-red-200">
        <CardContent className="p-6" role="alert">
          <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><p className="font-semibold text-red-950">Не удалось загрузить досье</p><p className="mt-1 text-sm text-red-800">{dossierError}</p></div></div>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Повторить</Button>
        </CardContent>
      </Card>
    </div>
  );

  const genSummary = async () => {
    setSummaryBusy(true);
    setSummaryError("");
    try {
      const nextSummary = await api.summary(d.id);
      setSummary(nextSummary);
      setSummaryOpen(true);
      setSummaryError("");
    } catch (reason) {
      setSummaryError(reason instanceof Error ? reason.message : "Не удалось сформировать саммари");
    } finally {
      setSummaryBusy(false);
    }
  };

  const retryExternalChecks = async () => {
    const requestId = d.active_more_info_request?.id;
    if (!requestId || d.active_more_info_request?.type !== "SYSTEM_RETRY") {
      setRetryError("Активная системная проверка не найдена. Обновите досье.");
      return;
    }
    const scope = `bank:application:${d.id}:more-info-retry:${requestId}`;
    const key = getMutationKey(scope);
    setBusy(true);
    setRetryError("");
    try {
      await api.retryMoreInfo(d.id, key);
      clearMutationKey(scope);
      setUnresolvedCommand(null);
      await load();
    } catch (reason) {
      const recovery = await recoverMutationOutcome(
        reason,
        () => api.dossier(d.id),
        (current) => externalRetryApplied(requestId, current),
      );
      if (recovery.status === "applied") {
        clearMutationKey(scope);
        setUnresolvedCommand(null);
        dossierRef.current = recovery.value;
        setD(recovery.value);
      } else if (recovery.status === "retry") {
        setUnresolvedCommand(null);
        dossierRef.current = recovery.value;
        setD(recovery.value);
        setRetryError("Сервер подтвердил, что повторная проверка не запускалась. Команду можно безопасно повторить с тем же ключом.");
      } else if (recovery.status === "unresolved") {
        setUnresolvedCommand({ kind: "retry", requestId });
        setRetryError(`Результат команды неизвестен. Не запускайте проверку повторно до обновления досье. ${recovery.error.message}`);
      } else {
        clearMutationKey(scope);
        setUnresolvedCommand(null);
        setRetryError(recovery.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitReportReview = async () => {
    if (!reportReview) return;
    if (reportReview.action === "REJECT" && reportReviewReason.trim().length < 3) {
      setReportReviewError("Укажите причину отклонения отчётности.");
      return;
    }
    setBusy(true);
    setReportReviewError("");
    try {
      await api.reviewFinancialReport(d.id, reportReview.reportId, reportReview.action === "VERIFY"
        ? { action: "VERIFY" }
        : { action: "REJECT", reason: reportReviewReason.trim() });
      setReportReview(null);
      setReportReviewReason("");
      await load();
      if (reportReview.action === "REJECT") await loadRecommendation();
    } catch (reason) {
      setReportReviewError(reason instanceof Error ? reason.message : "Не удалось изменить статус отчётности");
    } finally {
      setBusy(false);
    }
  };

  const confirmIssuance = async () => {
    setBusy(true);
    setIssuanceError("");
    const scope = `bank:application:${d.id}:issue`;
    const key = getMutationKey(scope);
    try {
      await api.issueApplication(d.id, key);
      clearMutationKey(scope);
      setUnresolvedCommand(null);
      setIssuanceOpen(false);
      await load();
    } catch (reason) {
      const recovery = await recoverMutationOutcome(reason, () => api.dossier(d.id), issuanceApplied);
      if (recovery.status === "applied") {
        clearMutationKey(scope);
        setUnresolvedCommand(null);
        dossierRef.current = recovery.value;
        setD(recovery.value);
        setIssuanceOpen(false);
      } else if (recovery.status === "retry") {
        setUnresolvedCommand(null);
        dossierRef.current = recovery.value;
        setD(recovery.value);
        setIssuanceError("Сервер подтвердил, что выдача не была зафиксирована. Команду можно безопасно повторить с тем же ключом.");
      } else if (recovery.status === "unresolved") {
        setUnresolvedCommand({ kind: "issue" });
        setIssuanceOpen(false);
        setIssuanceError(`Результат команды неизвестен. Не подтверждайте выдачу повторно до обновления досье. ${recovery.error.message}`);
      } else {
        clearMutationKey(scope);
        setUnresolvedCommand(null);
        setIssuanceError(recovery.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitDecision = async () => {
    if (!canOpenConfirmation) {
      setDecisionError(creditTermsError || "Укажите причину решения.");
      return;
    }
    const input: BankDecisionInput = decision.type === "MORE_INFO" ? {
      type: "MORE_INFO",
      reason: decision.reason,
      request_type: decision.request_type,
      required_fields: decision.required_fields.split(",").map((value) => value.trim()).filter(Boolean),
      required_files: decision.required_files.split(",").map((value) => value.trim()).filter(Boolean),
      due_days: Number(decision.due_days),
    } : decision.type === "REJECT" ? {
      type: "REJECT",
      reason: decision.reason,
    } : {
      type: decision.type,
      product_id: decision.product_id ? Number(decision.product_id) : undefined,
      rate: Number(decision.rate),
      amount: Number(decision.amount),
      term_months: Number(decision.term_months),
      reason: decision.reason,
    };
    const decisionType = input.type;
    const scope = `bank:application:${d.id}:decision`;
    const key = getMutationKey(scope);
    setBusy(true);
    setDecisionError("");
    try {
      await api.decide(d.id, input, key);
      clearMutationKey(scope);
      setUnresolvedCommand(null);
      setDecision(EMPTY_DECISION);
      setConfirmOpen(false);
      void load();
    } catch (reason) {
      const recovery = await recoverMutationOutcome(
        reason,
        () => api.dossier(d.id),
        (current) => decisionApplied(decisionType, current),
      );
      setConfirmOpen(false);
      if (recovery.status === "applied") {
        clearMutationKey(scope);
        setUnresolvedCommand(null);
        dossierRef.current = recovery.value;
        setD(recovery.value);
        setDecision(EMPTY_DECISION);
      } else if (recovery.status === "retry") {
        setUnresolvedCommand(null);
        dossierRef.current = recovery.value;
        setD(recovery.value);
        setDecisionError("Сервер подтвердил, что решение не было сохранено. Команду можно безопасно повторить с тем же ключом.");
      } else if (recovery.status === "unresolved") {
        setUnresolvedCommand({ kind: "decision", decisionType });
        setDecisionError(`Результат команды неизвестен. Не отправляйте решение повторно до обновления досье. ${recovery.error.message}`);
      } else {
        clearMutationKey(scope);
        setUnresolvedCommand(null);
        setDecisionError(recovery.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterUnknownOutcome = async () => {
    const command = unresolvedCommand;
    const next = await load();
    if (!command || !next) return;
    const applied = command.kind === "issue"
      ? issuanceApplied(next)
      : command.kind === "retry"
        ? externalRetryApplied(command.requestId, next)
        : decisionApplied(command.decisionType, next);
    const scope = command.kind === "issue"
      ? `bank:application:${next.id}:issue`
      : command.kind === "retry"
        ? `bank:application:${next.id}:more-info-retry:${command.requestId}`
        : `bank:application:${next.id}:decision`;
    if (applied) {
      clearMutationKey(scope);
      if (command.kind === "decision") setDecision(EMPTY_DECISION);
      if (command.kind === "retry") setRetryError("");
    } else if (command.kind === "retry") {
      setRetryError("Сервер подтвердил, что повторная проверка не запускалась. Команду можно безопасно повторить с тем же ключом.");
    }
    setUnresolvedCommand(null);
    setDecisionError("");
    setIssuanceError("");
  };

  const applyRec = () => {
    if (!rec?.proposal) return;
    const p = rec.proposal;
    const type = (p.type === "CONDITIONS" ? "CONDITIONS" : p.type) as DecisionType;
    const productId = p.productId != null ? String(p.productId) : String(d.product_id);
    const product = products.find((item) => String(item.id) === productId);
    setDecision({
      type,
      product_id: productId,
      rate: p.rate != null ? String(p.rate) : hasCreditTerms(type) && product ? String(product.rate_from) : "",
      amount: p.amount != null ? String(p.amount) : hasCreditTerms(type) ? String(d.amount) : "",
      term_months: p.termMonths != null ? String(p.termMonths) : hasCreditTerms(type) ? String(d.term_months) : "",
      reason: p.reason || "",
      request_type: type === "MORE_INFO" ? "FINANCIALS" : decision.request_type,
      required_fields: decision.required_fields,
      required_files: decision.required_files,
      due_days: decision.due_days,
    });
  };

  const canDecide = d.status === "DECISION";
  const creditDecision = hasCreditTerms(decision.type);
  const selectedProduct = products.find((product) => String(product.id) === decision.product_id);
  const eligibleProductIds = new Set(d.product_eligibility.filter((item) => item.eligible).map((item) => item.productId));
  const eligibleProducts = products.filter((product) => eligibleProductIds.has(product.id));
  const selectedEligibility = d.product_eligibility.find((item) => String(item.productId) === decision.product_id);
  const scoringFinancialReport = rec?.financialReport
    ? d.financial_reports.find((report) => report.id === rec.financialReport?.id) ?? rec.financialReport
    : null;
  const financialVerificationError = creditDecision && scoringFinancialReport?.status !== "VERIFIED"
    ? "Подтвердите финансовую отчётность, использованную в предварительном скоринге."
    : "";
  const productEligibilityError = creditDecision && selectedEligibility && !selectedEligibility.eligible
    ? selectedEligibility.violations.map((violation) => violation.message).join("; ")
    : "";
  const creditTermsError = creditDecision
    ? validateCreditTerms(decision, selectedProduct, productsBusy) || productEligibilityError || financialVerificationError
    : "";
  const moreInfoError = decision.type === "MORE_INFO"
    ? !Number.isInteger(Number(decision.due_days)) || Number(decision.due_days) < 1 || Number(decision.due_days) > 30
      ? "Срок ответа должен быть от 1 до 30 дней."
      : decision.request_type === "DOCUMENT" && !decision.required_files.trim()
        ? "Укажите обязательные документы через запятую."
        : decision.request_type === "COMPANY_DATA" && !decision.required_fields.trim()
          ? "Укажите обязательные поля компании через запятую."
          : ""
    : "";
  const canOpenConfirmation = Boolean(decision.reason.trim()) && !creditTermsError && !moreInfoError;
  const storedTerms = resolveCreditTerms(d.decision);
  const storedTermsError = d.decision && hasCreditTerms(d.decision.type) ? creditTermsSnapshotError(d.decision) : null;
  const preliminaryTerms = resolveCreditTerms(d.preliminaryTerms);
  const hasStoredCreditTerms = Boolean(d.decision && hasCreditTerms(d.decision.type));
  const productRateFrom = d.product_rate_from ?? products.find((product) => product.id === d.product_id)?.rate_from ?? null;
  const requestedRate = preliminaryTerms.rate !== null
    ? { value: `${preliminaryTerms.rate.toLocaleString("ru-RU")}% годовых`, status: "Предварительный расчёт" }
    : productRateFrom !== null
      ? { value: `от ${productRateFrom.toLocaleString("ru-RU")}% годовых`, status: "Ставка продукта" }
      : { value: "Не определена", status: "Нет данных" };
  const signedDocuments = d.documents.filter((document) => document.status === "SIGNED");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b bg-[#1a1a1a] text-white">
        <div className="mx-auto flex min-h-14 h-auto max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-white hover:bg-white/10">
            <Link to="/bank"><ArrowLeft className="mr-1 h-4 w-4" /> Очередь</Link>
          </Button>
          <div className="min-w-0 flex-[1_1_12rem]">
            <span className="block break-words font-bold leading-tight">{d.company?.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-neutral-400">{d.public_no}</span>
            <StatusBadge status={d.status} label={d.status_label} />
            {d.grade && <GradeBadge grade={d.grade} />}
          </div>
          {!['ISSUED', 'REJECTED', 'DECLINED_BY_CLIENT'].includes(d.status) && (
            <Button type="button" variant="outline" size="sm" className="ml-auto shrink-0 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" disabled={dossierBusy || busy} onClick={() => void (unresolvedCommand ? refreshAfterUnknownOutcome() : load())} aria-label="Обновить данные досье">
              {dossierBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Обновить
            </Button>
          )}
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-3 gap-5">
        {unresolvedCommand && (
          <div className="lg:col-span-3 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <div><p className="font-semibold">Результат команды требует проверки</p><p className="mt-1">Повтор критической команды заблокирован. Получите актуальное состояние с сервера, чтобы не дублировать решение, выдачу или внешнюю проверку.</p></div>
            <Button type="button" variant="outline" size="sm" disabled={dossierBusy} onClick={() => void refreshAfterUnknownOutcome()}><RefreshCw className="h-4 w-4" /> Проверить результат</Button>
          </div>
        )}
        <div className="lg:col-span-2 space-y-5">
          {dossierError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-950" role="alert">
              <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div className="flex-1"><p className="font-semibold">Не удалось обновить досье</p><p className="mt-1 text-sm text-red-800">Показана последняя успешно загруженная версия. {dossierError}</p></div></div>
              <Button type="button" variant="outline" size="sm" className="mt-3 border-red-200 bg-white" disabled={dossierBusy} onClick={() => void load()}>{dossierBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Повторить</Button>
            </div>
          )}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Параметры заявки</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <p className="font-semibold sm:col-span-2">Запрошено клиентом</p>
                <p><span className="text-muted-foreground">Продукт:</span> {d.product_name}</p>
                <p><span className="text-muted-foreground">Сумма:</span> <b>{d.amount.toLocaleString("ru-RU")} ₽</b> на {d.term_months} мес.</p>
                <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Ставка:</span> <b>{requestedRate.value}</b> <Badge variant="outline" className="font-normal">{requestedRate.status}</Badge></p>
                <p className="sm:col-span-2"><span className="text-muted-foreground">Цель:</span> {d.purpose} ({d.purpose_category})</p>
                <p><span className="text-muted-foreground">Подача:</span> {fmtDate(d.created_at)}</p>
                <p><span className="text-muted-foreground">Клиент:</span> {d.client_name}</p>
              </div>
              {hasStoredCreditTerms && (
                <div className="grid gap-x-6 gap-y-2 border-t pt-4 sm:grid-cols-2">
                  <p className="font-semibold sm:col-span-2">Предложено банком</p>
                  <p><span className="text-muted-foreground">Продукт:</span> {d.decision?.productName || "Не определён"}</p>
                  <p><span className="text-muted-foreground">Сумма:</span> <b>{storedTerms.amount !== null ? fmtMoney(storedTerms.amount) : "Не определена"}</b> на {storedTerms.termMonths ?? "—"} мес.</p>
                  <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Утверждённая ставка:</span> <b>{storedTerms.rate !== null ? `${storedTerms.rate.toLocaleString("ru-RU")}% годовых` : "Не определена"}</b></p>
                </div>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="company">
            <TabsList className="h-auto w-full justify-start overflow-x-auto p-1 [scrollbar-width:thin] sm:grid sm:grid-cols-4">
              <TabsTrigger value="company" className="shrink-0 whitespace-nowrap px-3 py-2 text-xs sm:min-w-0 sm:px-2 sm:text-sm">Компания и реестр</TabsTrigger>
              <TabsTrigger value="bki" className="shrink-0 whitespace-nowrap px-3 py-2 text-xs sm:min-w-0 sm:px-2 sm:text-sm">Кредитная история</TabsTrigger>
              <TabsTrigger value="fin" className="shrink-0 whitespace-nowrap px-3 py-2 text-xs sm:min-w-0 sm:px-2 sm:text-sm">Финансовая отчётность</TabsTrigger>
              <TabsTrigger value="events" className="shrink-0 whitespace-nowrap px-3 py-2 text-xs sm:min-w-0 sm:px-2 sm:text-sm">История процесса</TabsTrigger>
            </TabsList>
            <TabsContent value="company">
              <Card><CardContent className="pt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <p><span className="text-muted-foreground">Наименование:</span> {d.company?.name}</p>
                <p><span className="text-muted-foreground">Форма:</span> {d.company?.form}</p>
                <p><span className="text-muted-foreground">ИНН:</span> <span className="font-mono">{d.company?.inn}</span></p>
                <p><span className="text-muted-foreground">ОГРН:</span> <span className="font-mono">{d.company?.ogrn}</span></p>
                <p><span className="text-muted-foreground">ОКВЭД:</span> {d.company?.okved_code} — {d.company?.okved_name}</p>
                <p><span className="text-muted-foreground">Регистрация:</span> {d.company?.reg_date}</p>
                <p className="sm:col-span-2"><span className="text-muted-foreground">Адрес:</span> {d.company?.address}</p>
                <p className="sm:col-span-2"><span className="text-muted-foreground">Руководитель:</span> {d.company?.head_name}</p>
                <div className="sm:col-span-2 mt-2 space-y-2 border-t pt-3 text-xs">
                  <p className="text-muted-foreground">
                    {d.external_checks.registry?.status === "SUCCESS"
                      ? `Данные синтетического реестра получены ${fmtDate(d.external_checks.registry.requested_at)}.`
                      : d.external_checks.registry?.status === "NOT_FOUND"
                        ? `Запись в синтетическом реестре не найдена (${fmtDate(d.external_checks.registry.requested_at)}).`
                        : d.external_checks.registry?.status === "ERROR"
                          ? `Проверка синтетического реестра завершилась ошибкой (${fmtDate(d.external_checks.registry.requested_at)}).`
                          : "Проверка реестра для этой заявки не зафиксирована."}
                  </p>
                  <p className="rounded-lg bg-amber-50 p-2 text-amber-950">Источник данных синтетический: это демонстрационный набор, а не ответ государственного реестра.{d.external_checks.registry?.status !== "SUCCESS" ? " Показаны сведения из локального профиля компании; успешного снимка реестра нет." : ""}</p>
                  <details className="rounded-lg border bg-white p-2 text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">Технические сведения</summary>
                    {d.external_checks.registry ? (
                      <dl className="mt-2 space-y-1">
                        <div><dt className="inline">Статус: </dt><dd className="inline font-mono">{d.external_checks.registry.status}</dd></div>
                        <div><dt className="inline">Provider: </dt><dd className="inline font-mono">{d.external_checks.registry.provider}</dd></div>
                        <div><dt className="inline">Версия: </dt><dd className="inline font-mono">{d.external_checks.registry.provider_version}</dd></div>
                        <div><dt className="inline">Snapshot: </dt><dd className="inline">зафиксирован {fmtDate(d.external_checks.registry.requested_at)} для этой заявки</dd></div>
                      </dl>
                    ) : <p className="mt-2">Snapshot отсутствует.</p>}
                  </details>
                </div>
              </CardContent></Card>
            </TabsContent>
            <TabsContent value="bki">
              <Card><CardContent className="pt-4">
                {d.bki ? (
                  <div className="grid sm:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Скор БКИ</p><p className={`text-xl font-bold ${d.bki.bki_score >= 650 ? "text-emerald-600" : d.bki.bki_score >= 550 ? "text-amber-600" : "text-red-600"}`}>{d.bki.bki_score}</p></div>
                    <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Активные кредиты</p><p className="text-xl font-bold">{d.bki.active_credits}</p><p className="text-xs text-muted-foreground">долг {fmtMoney(d.bki.total_debt)}</p></div>
                    <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Просрочки</p><p className={`text-xl font-bold ${d.bki.overdue_count === 0 ? "text-emerald-600" : "text-red-600"}`}>{d.bki.overdue_count}</p><p className="text-xs text-muted-foreground">макс. {d.bki.worst_delay_days} дн.</p></div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Данные БКИ не получены.</p>}
                <div className="mt-3 space-y-2 text-xs">
                  <p className="text-muted-foreground">
                    {d.external_checks.bki?.status === "SUCCESS"
                      ? `Синтетическая кредитная история получена ${fmtDate(d.external_checks.bki.requested_at)}.`
                      : d.external_checks.bki?.status === "NOT_FOUND"
                        ? `Синтетическая кредитная история не найдена (${fmtDate(d.external_checks.bki.requested_at)}).`
                        : d.external_checks.bki?.status === "ERROR"
                          ? `Проверка кредитной истории завершилась ошибкой (${fmtDate(d.external_checks.bki.requested_at)}).`
                          : "Кредитная история для этой заявки не получена."}
                  </p>
                  <p className="rounded-lg bg-amber-50 p-2 text-amber-950">Источник данных синтетический: это демонстрационная кредитная история, а не ответ реального БКИ.</p>
                  <details className="rounded-lg border bg-white p-2 text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">Технические сведения</summary>
                    {d.external_checks.bki ? (
                      <dl className="mt-2 space-y-1">
                        <div><dt className="inline">Статус: </dt><dd className="inline font-mono">{d.external_checks.bki.status}</dd></div>
                        <div><dt className="inline">Provider: </dt><dd className="inline font-mono">{d.external_checks.bki.provider}</dd></div>
                        <div><dt className="inline">Версия: </dt><dd className="inline font-mono">{d.external_checks.bki.provider_version}</dd></div>
                        <div><dt className="inline">Snapshot: </dt><dd className="inline">зафиксирован {fmtDate(d.external_checks.bki.requested_at)} для этой заявки</dd></div>
                      </dl>
                    ) : <p className="mt-2">Snapshot отсутствует.</p>}
                  </details>
                </div>
              </CardContent></Card>
            </TabsContent>
            <TabsContent value="fin">
              <Card><CardContent className="space-y-3 pt-4">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                  Клиентские данные участвуют только в предварительной оценке. Положительное решение заблокировано, пока сотрудник банка не подтвердит использованный отчёт.
                </div>
                {d.financial_reports.map((report) => {
                  const usedInScoring = rec?.financialReport?.id === report.id;
                  return (
                    <div key={report.id} className={`rounded-xl border p-4 text-sm ${usedInScoring ? "border-blue-300 bg-blue-50/40" : ""}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">Отчётность за {report.year} год {usedInScoring && <Badge variant="outline" className="ml-1 border-blue-300 text-blue-800">Использована в скоринге</Badge>}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Источник: {FINANCIAL_SOURCE_LABELS[report.source]} · передана {fmtDate(report.submittedAt)}</p>
                        </div>
                        <Badge className={report.status === "VERIFIED" ? "bg-emerald-700" : report.status === "REJECTED" ? "bg-red-600" : "bg-amber-100 text-amber-900"}>{FINANCIAL_STATUS_LABELS[report.status]}</Badge>
                      </div>
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div><dt className="text-xs text-muted-foreground">Выручка</dt><dd className="font-medium">{fmtMoney(report.revenue)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Чистая прибыль</dt><dd className={report.profit >= 0 ? "font-medium text-emerald-700" : "font-medium text-red-700"}>{fmtMoney(report.profit)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Собственный капитал</dt><dd className="font-medium">{fmtMoney(report.ownCapital)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Ежемес. обязательства</dt><dd className="font-medium">{fmtMoney(report.monthlyObligations)}</dd></div>
                      </dl>
                      {report.verifiedAt && <p className="mt-2 text-xs text-emerald-800">Подтверждена {fmtDate(report.verifiedAt)}</p>}
                      {report.rejectionReason && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-900">Причина отклонения: {report.rejectionReason}</p>}
                      {report.status === "SUBMITTED" && d.status === "DECISION" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => { setReportReviewError(""); setReportReview({ reportId: report.id, action: "VERIFY" }); }}>Подтвердить данные</Button>
                          <Button size="sm" variant="destructive" onClick={() => { setReportReviewError(""); setReportReview({ reportId: report.id, action: "REJECT" }); }}>Отклонить и запросить заново</Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {d.financial_reports.length === 0 && <p className="text-sm text-muted-foreground">Отчётность не предоставлена.</p>}
              </CardContent></Card>
            </TabsContent>
            <TabsContent value="events">
              <Card><CardContent className="pt-4"><EventLog events={d.events} /></CardContent></Card>
            </TabsContent>
          </Tabs>

          {d.score_details && d.score != null && d.grade && (
            <ScoreCard score={d.score} grade={d.grade} factors={d.score_details} version={d.scorecard_version} />
          )}
        </div>

        <div className="space-y-5">
          {d.status === "READY_FOR_ISSUANCE" && (
            <Card className="border-cyan-300 bg-cyan-50/60">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base text-cyan-950"><Banknote className="h-5 w-5" /> Модельная выдача готова к подтверждению</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-cyan-950">
                <p>Заявка <b>{d.public_no}</b>. Клиентское demo-подписание зафиксировано {d.signed_at ? fmtDate(d.signed_at) : "на сервере"}.</p>
                <div>
                  <p className="font-semibold">Подписанный пакет</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {signedDocuments.map((document) => <li key={document.id}>{document.kind} · версия {document.document_version || "не указана"}</li>)}
                  </ul>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                  <p className="font-semibold">Только демонстрация</p>
                  <p className="mt-1">Подтверждение изменит статус заявки, но не создаст банковскую проводку, кредитный счёт и реальное перечисление средств.</p>
                </div>
                {(signedDocuments.length === 0 || signedDocuments.length !== d.documents.length) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">Подписанный пакет неполон. Обновите досье; сервер не позволит подтвердить выдачу до восстановления целостности документов.</p>}
                {issuanceError && <p role="alert" className="text-red-700">{issuanceError}</p>}
                <Button className="w-full whitespace-normal" disabled={busy || Boolean(unresolvedCommand) || signedDocuments.length === 0 || signedDocuments.length !== d.documents.length} onClick={() => { setIssuanceError(""); setIssuanceOpen(true); }}>
                  {busy ? <Loader2 className="animate-spin" /> : <Banknote />} Подтвердить модельную выдачу
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Решение по заявке</CardTitle>
                {canDecide && (
                  <div className="flex flex-wrap gap-2">
                    {summary ? (
                      <>
                        <Button type="button" variant="outline" size="sm" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((open) => !open)}>
                          {summaryOpen ? "Скрыть саммари" : "Показать саммари"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => void genSummary()} disabled={summaryBusy}>
                          {summaryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Обновить
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => void genSummary()} disabled={summaryBusy}>
                        {summaryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} {summaryBusy ? "Формируется…" : "Сформировать саммари"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary && summaryOpen && (
                <div className="rounded-lg bg-neutral-100 p-3 text-xs whitespace-pre-wrap">
                  {summary.text}
                  <p className="mt-2 text-[10px] text-muted-foreground">Источник: детерминированный шаблон, без ИИ. Скрытие не удаляет загруженный текст.</p>
                </div>
              )}
              {summaryError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900" role="alert">
                  <p>Не удалось сформировать саммари: {summaryError}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2 h-7 border-red-200 bg-white text-xs" onClick={() => void genSummary()} disabled={summaryBusy}><RefreshCw className="h-3.5 w-3.5" /> Повторить</Button>
                </div>
              )}
              {canDecide && recommendationBusy && !rec && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка рекомендации…</p>}
              {canDecide && recommendationError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900" role="alert">
                  <p>Не удалось загрузить рекомендацию: {recommendationError}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2 h-7 border-red-200 bg-white text-xs" onClick={() => void loadRecommendation()} disabled={recommendationBusy}><RefreshCw className="h-3.5 w-3.5" /> Повторить</Button>
                </div>
              )}
              {canDecide && rec && (
                <div className="space-y-3 rounded-lg border border-dashed p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-muted-foreground">Рекомендация конвейера</p>
                      <p className="text-base font-semibold text-foreground">{rec.proposal.type === "APPROVE" ? "Одобрить" : rec.proposal.type === "CONDITIONS" ? "Изменить условия" : rec.proposal.type === "MORE_INFO" ? "Запросить информацию" : "Отказать"}</p>
                    </div>
                    <div className="text-right"><GradeBadge grade={rec.grade} /><p className="mt-1 text-muted-foreground">{rec.score} баллов</p></div>
                  </div>
                  <p className="text-muted-foreground">Рассчитана {fmtDate(rec.calculatedAt)}</p>
                  <p>{rec.proposal.reason}</p>
                  <div>
                    <p className="font-semibold">Факторы рекомендации</p>
                    <ul className="mt-1 space-y-1.5">
                      {rec.factors.map((factor) => (
                        <li key={factor.key} className="rounded-md bg-neutral-50 p-2">
                          <span className="font-medium">{factor.label}: {factor.value}</span>
                          <span className="block text-muted-foreground">{factor.explanation}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {rec.financialReport && <p className={scoringFinancialReport?.status === "VERIFIED" ? "text-emerald-800" : "rounded bg-amber-50 p-2 text-amber-900"}>Финансовые данные: {rec.financialReport.year} год, источник {FINANCIAL_SOURCE_LABELS[rec.financialReport.source]}, статус {FINANCIAL_STATUS_LABELS[scoringFinancialReport?.status ?? rec.financialReport.status]}.</p>}
                  {rec.supersededAt && <p className="font-medium text-orange-800">Архивирована {fmtDate(rec.supersededAt)} после запроса №{rec.supersededByRequestId}. После ответа будет сформирована новая рекомендация.</p>}
                  <p className="rounded-lg bg-amber-50 p-2 text-amber-950">Это демонстрационная рекомендация по детерминированным правилам. Внешние данные БКИ и реестра в этом контуре синтетические; источник финансовой отчётности указан выше. Рекомендация не является решением банка и не получена от внешней модели или ИИ.</p>
                  <details className="rounded-lg border bg-white p-2 text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">Технические сведения о расчёте</summary>
                    <dl className="mt-2 space-y-1">
                      <div><dt className="inline">Rule-based version: </dt><dd className="inline font-mono">{rec.scorecardVersion}</dd></div>
                      <div><dt className="inline">Snapshot: </dt><dd className="inline">зафиксирован {fmtDate(rec.calculatedAt)}</dd></div>
                    </dl>
                    <p className="mt-2">Повторное открытие досье и кнопка «Обновить» не запускают пересчёт. После запроса дополнительных данных текущая рекомендация архивируется, а после ответа конвейер формирует новую.</p>
                  </details>
                  <Button size="sm" variant="secondary" onClick={applyRec} disabled={Boolean(rec.supersededAt)}>Подставить в форму</Button>
                </div>
              )}
              {!canDecide && (
                <p className="text-sm text-muted-foreground">
                  {d.status === "MORE_INFO"
                    ? "Новое решение недоступно, пока выполняется системная проверка или ожидается ответ клиента. После ответа заявка повторно пройдёт конвейер и вернётся на этап кредитного решения."
                    : "Решение доступно только на этапе «Кредитное решение»."} Текущий статус: <StatusBadge status={d.status} label={d.status_label} />
                </p>
              )}
              {canDecide && (
                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <Label>Тип решения</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {([["APPROVE", "Одобрить"], ["CONDITIONS", "Изменить условия"], ["MORE_INFO", "Запросить инфо"], ["REJECT", "Отказать"]] as const).map(([v, l]) => (
                        <Button key={v} type="button" size="sm" variant={decision.type === v ? "default" : "outline"}
                          className={decision.type === v ? "" : ""} onClick={() => setDecision((current) => selectDecisionType(current, v, d, products))}>{l}</Button>
                      ))}
                    </div>
                  </div>
                  {decision.type !== "MORE_INFO" && decision.type !== "REJECT" && (
                    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                      <div className="space-y-1">
                        <Label htmlFor="decision-product" className="text-xs flex items-center gap-1"><Landmark className="h-3.5 w-3.5" /> Предлагаемый продукт</Label>
                        {productsBusy && products.length === 0 && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка продуктов…</p>}
                        {productsError && (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-900" role="alert">
                            <p>Не удалось загрузить продукты: {productsError}</p>
                            <Button type="button" variant="outline" size="sm" className="mt-2 h-7 border-red-200 bg-white text-xs" onClick={() => void loadProducts()} disabled={productsBusy}><RefreshCw className="h-3.5 w-3.5" /> Повторить</Button>
                          </div>
                        )}
                        <Select value={decision.product_id || String(d.product_id)} onValueChange={(value) => {
                          const selected = products.find((product) => String(product.id) === value);
                          const alternative = Number(value) !== d.product_id;
                          setDecision({ ...decision, product_id: value, type: alternative ? "CONDITIONS" : decision.type, rate: selected ? String(selected.rate_from) : "" });
                        }}>
                          <SelectTrigger id="decision-product" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>{eligibleProducts.map((product) => <SelectItem key={product.id} value={String(product.id)}>{product.name} · от {product.rate_from}%</SelectItem>)}</SelectContent>
                        </Select>
                        {eligibleProducts.length === 0 && <p className="text-xs text-red-700" role="alert">По выручке и цели заявки нет продукта, доступного для положительного решения. Запросите уточнение или примите отказ с понятным обоснованием.</p>}
                        <p className="text-[11px] text-muted-foreground">Список отфильтрован сервером по цели заявки и подтверждённой выручке.</p>
                        {Number(decision.product_id || d.product_id) !== d.product_id && <p className="flex items-center gap-1 text-xs text-blue-800"><Shuffle className="h-3.5 w-3.5" /> Альтернатива исходному продукту. Клиент увидит сравнение условий.</p>}
                      </div>
                      <div className="grid gap-2 tablet:grid-cols-3">
                        <div className="space-y-1"><Label htmlFor="decision-rate" className="text-xs">Ставка, %</Label><Input id="decision-rate" type="number" step="0.1" min={selectedProduct?.rate_from} value={decision.rate} onChange={(e) => setDecision({ ...decision, rate: e.target.value })} placeholder={selectedProduct ? String(selectedProduct.rate_from) : "18.5"} /></div>
                        <div className="space-y-1"><Label htmlFor="decision-amount" className="text-xs">Сумма, ₽</Label><Input id="decision-amount" type="number" min={selectedProduct?.min_amount} max={selectedProduct?.max_amount} value={decision.amount} onChange={(e) => setDecision({ ...decision, amount: e.target.value, type: Number(e.target.value) !== d.amount ? "CONDITIONS" : decision.type })} placeholder={String(d.amount)} /></div>
                        <div className="space-y-1"><Label htmlFor="decision-term" className="text-xs">Срок, мес.</Label><Input id="decision-term" type="number" step="1" min={selectedProduct?.term_min} max={selectedProduct?.term_max} value={decision.term_months} onChange={(e) => setDecision({ ...decision, term_months: e.target.value, type: Number(e.target.value) !== d.term_months ? "CONDITIONS" : decision.type })} placeholder={String(d.term_months)} /></div>
                      </div>
                      {creditTermsError && <p className="text-xs text-red-700" role="alert">{creditTermsError}</p>}
                    </div>
                  )}
                  {decision.type === "MORE_INFO" && (
                    <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50/60 p-3">
                      <div className="space-y-1">
                        <Label htmlFor="more-info-type" className="text-xs">Что требуется</Label>
                        <Select value={decision.request_type} onValueChange={(value: MoreInfoRequestType) => setDecision({ ...decision, request_type: value, required_fields: "", required_files: "" })}>
                          <SelectTrigger id="more-info-type" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(MORE_INFO_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {decision.request_type === "DOCUMENT" && <div className="space-y-1"><Label htmlFor="more-info-files" className="text-xs">Обязательные документы через запятую</Label><Input id="more-info-files" value={decision.required_files} onChange={(event) => setDecision({ ...decision, required_files: event.target.value })} placeholder="Баланс, выписка по счёту" /></div>}
                      {decision.request_type === "COMPANY_DATA" && <div className="space-y-1"><Label htmlFor="more-info-fields" className="text-xs">Поля через запятую</Label><Input id="more-info-fields" value={decision.required_fields} onChange={(event) => setDecision({ ...decision, required_fields: event.target.value })} placeholder="address, head_name, okved_code" /><p className="text-[11px] text-muted-foreground">Доступно: address, head_name, okved_code, okved_name.</p></div>}
                      <div className="space-y-1"><Label htmlFor="more-info-due" className="text-xs">Срок ответа, дней</Label><Input id="more-info-due" type="number" min="1" max="30" value={decision.due_days} onChange={(event) => setDecision({ ...decision, due_days: event.target.value })} /></div>
                      {decision.request_type === "SYSTEM_RETRY" && <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-900">Клиенту будет показано, что действие не требуется. Повтор проверки запускает сотрудник банка.</p>}
                      {moreInfoError && <p className="text-xs text-red-700" role="alert">{moreInfoError}</p>}
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                      <p className="font-semibold">Этот текст увидит клиент</p>
                      <p className="mt-1">Перед отправкой проверьте формулировки, факты и инструкции: обоснование будет показано клиенту без дополнительного редактирования.</p>
                    </div>
                    <Label htmlFor="decision-reason" className="text-xs">{decision.type === "MORE_INFO" ? "Точная причина и инструкция клиенту" : "Обоснование решения для клиента"}</Label>
                    <Textarea id="decision-reason" className="min-h-44 resize-y" value={decision.reason} onChange={(e) => setDecision({ ...decision, reason: e.target.value })} placeholder="Введите полное и понятное клиенту обоснование решения" required />
                  </div>
                  {decisionError && <p className="text-xs text-red-600" role="alert">{decisionError}</p>}
                  <Button className="w-full" disabled={busy || Boolean(unresolvedCommand) || !canOpenConfirmation} onClick={() => { setDecisionError(""); setConfirmOpen(true); }}>
                    Принять решение
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {d.active_more_info_request && (
            <Card className="border-orange-300">
              <CardHeader className="pb-2"><CardTitle className="text-base">Активный запрос дополнительной информации</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge className="bg-orange-100 text-orange-900">{MORE_INFO_TYPE_LABELS[d.active_more_info_request.type]}</Badge>
                  <span className="text-xs text-muted-foreground">{MORE_INFO_STATUS_LABELS[d.active_more_info_request.status]} · до {fmtDate(d.active_more_info_request.dueAt)}</span>
                </div>
                <p>{d.active_more_info_request.reason}</p>
                {d.active_more_info_request.requiredFields.length > 0 && <p className="text-xs text-muted-foreground">Обязательные поля: {d.active_more_info_request.requiredFields.map((field) => COMPANY_DATA_FIELD_LABELS[field] || field).join(", ")}</p>}
                {d.active_more_info_request.requiredFiles.length > 0 && <p className="text-xs text-muted-foreground">Обязательные файлы: {d.active_more_info_request.requiredFiles.join(", ")}</p>}
                {d.active_more_info_request.response && <div className="rounded-lg border bg-neutral-50 p-3 text-xs"><p className="font-semibold">Ответ получен {fmtDate(d.active_more_info_request.response.createdAt)} · {MORE_INFO_SOURCE_LABELS[d.active_more_info_request.response.source]}</p><MoreInfoResponseDetails response={d.active_more_info_request.response} /></div>}
                {d.active_more_info_request.type === "SYSTEM_RETRY" && (
                  <div className="space-y-2">
                    {retryError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800" role="alert">{retryError}</p>}
                    <Button className="w-full" variant="outline" disabled={busy || Boolean(unresolvedCommand)} onClick={() => void retryExternalChecks()}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Повторить внешние проверки</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(d.more_info_requests?.length ?? 0) > 1 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">История запросов и ответов</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {d.more_info_requests!.map((request) => (
                  <div key={request.id} className="rounded-lg border p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2"><b>{MORE_INFO_TYPE_LABELS[request.type]}</b><span>{MORE_INFO_STATUS_LABELS[request.status]}</span></div>
                    <p className="mt-1 text-muted-foreground">{request.reason}</p>
                    <p className="mt-1 text-muted-foreground">Инициатор: {MORE_INFO_SOURCE_LABELS[request.source]} · создан {fmtDate(request.createdAt)}</p>
                    {request.response && <div className="mt-2 border-t pt-2"><p className="font-medium">Ответ {fmtDate(request.response.createdAt)} · {MORE_INFO_SOURCE_LABELS[request.response.source]}</p><MoreInfoResponseDetails response={request.response} /></div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {d.decision && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Текущее решение</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium">{DECISION_LABELS[d.decision.type]}</p>
                {d.decision.productName && <p>Продукт: <b>{d.decision.productName}</b>{d.decision.productId !== d.product_id && " (альтернатива банка)"}</p>}
                {hasCreditTerms(d.decision.type) && (
                  <>
                    <dl className="grid gap-2 rounded-lg border bg-neutral-50 p-3 sm:grid-cols-2">
                      <div><dt className="text-xs text-muted-foreground">Основной долг</dt><dd className="font-semibold">{fmtMoney(storedTerms.amount)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Номинальная ставка</dt><dd className="font-semibold">{storedTerms.rate === null ? "Не указано" : `${storedTerms.rate.toLocaleString("ru-RU")}% годовых`}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Срок</dt><dd className="font-semibold">{storedTerms.termMonths === null ? "Не указано" : `${storedTerms.termMonths} мес.`}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Ежемесячный платёж</dt><dd className="font-semibold">{fmtMoney(storedTerms.monthlyPayment)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Переплата</dt><dd className="font-semibold">{fmtMoney(storedTerms.overpayment)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Общая выплата</dt><dd className="font-semibold">{fmtMoney(storedTerms.totalPayment)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Тип платежа</dt><dd className="font-semibold">{paymentTypeLabel(d.decision.paymentType)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Срок действия</dt><dd className="font-semibold">{validUntilLabel(d.decision.validUntil)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Комиссии</dt><dd className="font-semibold">{d.decision.feesIncluded === false ? "Не моделируются и не включены" : "Данные не указаны"}</dd></div>
                    </dl>
                    <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-950">{ECONOMICS_DISCLOSURE}</p>
                    {storedTermsError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">Ошибка server snapshot: {storedTermsError}</p>}
                    {d.decision.finalRiskAssessment && (
                      <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Финальная оценка риска по утверждённым условиям</p><GradeBadge grade={d.decision.finalRiskAssessment.grade} /></div>
                        <dl className="grid gap-2 sm:grid-cols-2">
                          <div><dt className="text-blue-800">Продукт</dt><dd className="font-semibold">{d.decision.finalRiskAssessment.productName}</dd></div>
                          <div><dt className="text-blue-800">Оценённая сумма</dt><dd className="font-semibold">{fmtMoney(d.decision.finalRiskAssessment.assessedAmount)}</dd></div>
                          <div><dt className="text-blue-800">Итоговый балл</dt><dd className="font-semibold">{d.decision.finalRiskAssessment.score}</dd></div>
                          <div><dt className="text-blue-800">Дата оценки</dt><dd className="font-semibold">{fmtDate(d.decision.finalRiskAssessment.calculatedAt)}</dd></div>
                        </dl>
                        <div>
                          <p className="font-semibold">Факторы итоговой оценки</p>
                          <ul className="mt-1 space-y-1">
                            {d.decision.finalRiskAssessment.factors.map((factor) => <li key={factor.key}>{factor.label}: <b>{factor.value}</b> — {factor.explanation}</li>)}
                          </ul>
                        </div>
                        <details className="rounded-lg border border-blue-200 bg-white/70 p-2 text-blue-800">
                          <summary className="cursor-pointer font-medium text-blue-950">Технические сведения</summary>
                          <p className="mt-2">Model version: <span className="font-mono">{d.decision.finalRiskAssessment.scorecardVersion}</span></p>
                          <p className="mt-1">Snapshot сохранён {fmtDate(d.decision.finalRiskAssessment.calculatedAt)} и не заменяет исходную оценку заявки.</p>
                        </details>
                      </div>
                    )}
                  </>
                )}
                <p className="text-muted-foreground text-xs">{d.decision.reason}</p>
              </CardContent>
            </Card>
          )}

          {d.documents?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Документы</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {d.documents.map((doc) => (
                  <div key={doc.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium">{doc.kind}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{doc.signed_at ? `Подписан ${fmtDate(doc.signed_at)}` : `Сформирован ${fmtDate(doc.created_at)}`}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={doc.status === "SIGNED" ? "default" : "secondary"} className={doc.status === "SIGNED" ? "bg-emerald-700" : ""}>
                          {doc.status === "SIGNED" ? "Подписан" : "Сформирован"}
                        </Badge>
                        <Button asChild size="sm" variant="outline"><a href={api.documentDownloadUrl(doc.id)}><Download className="h-4 w-4" /> Скачать</a></Button>
                      </div>
                    </div>
                    <details className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-medium text-foreground">Сведения о документе</summary>
                      <dl className="mt-2 space-y-1">
                        <div><dt className="inline">Версия: </dt><dd className="inline font-mono">{doc.document_version || "не указана"}</dd></div>
                        <div><dt className="inline">SHA-256: </dt><dd className="inline break-all font-mono">{doc.content_hash || "не сохранён"}</dd></div>
                      </dl>
                      <div className="mt-2">
                        <p className="font-medium text-foreground">История</p>
                        <ul className="mt-1 space-y-1">
                          <li>Сформирован: {fmtDate(doc.created_at)}</li>
                          <li>Первое открытие или скачивание: {doc.opened_at ? fmtDate(doc.opened_at) : "не зафиксировано"}</li>
                          <li>Ознакомление клиента: {doc.acknowledged_at ? fmtDate(doc.acknowledged_at) : "не зафиксировано"}</li>
                          <li>Подписание: {doc.signed_at ? fmtDate(doc.signed_at) : "не зафиксировано"}</li>
                        </ul>
                      </div>
                    </details>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={issuanceOpen}
        title="Подтвердить модельную выдачу?"
        description={(
          <div className="space-y-3">
            <p>Заявка <b>{d.public_no}</b>. Подписание клиента зафиксировано {d.signed_at ? fmtDate(d.signed_at) : "на сервере"}.</p>
            <div>
              <p className="font-medium text-foreground">Подписанные документы:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{signedDocuments.map((document) => <li key={document.id}>{document.kind} · версия {document.document_version || "не указана"}</li>)}</ul>
            </div>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">Это demo-команда: она фиксирует отдельное банковское подтверждение выдачи, но не выполняет реальную проводку или перевод денег.</p>
          </div>
        )}
        confirmLabel="Подтвердить модельную выдачу"
        busy={busy}
        error={issuanceError}
        onConfirm={() => void confirmIssuance()}
        onOpenChange={(open) => { if (!open && !busy) { setIssuanceOpen(false); setIssuanceError(""); } }}
      />

      <ConfirmDialog
        open={Boolean(reportReview)}
        title={reportReview?.action === "VERIFY" ? "Подтвердить финансовые данные" : "Отклонить финансовые данные"}
        description={reportReview?.action === "VERIFY" ? (
          <p>После подтверждения отчётность будет считаться проверенной банком и станет доступна для финального положительного решения.</p>
        ) : (
          <div className="space-y-3">
            <p>Отчёт будет отклонён, рекомендация архивирована, а клиент получит новый запрос на исправленные данные.</p>
            <div className="space-y-1"><Label htmlFor="report-rejection-reason">Причина отклонения</Label><Textarea id="report-rejection-reason" value={reportReviewReason} onChange={(event) => setReportReviewReason(event.target.value)} placeholder="Укажите расхождение или недостающие подтверждения" /></div>
            {reportReviewError && <p className="text-sm text-red-700" role="alert">{reportReviewError}</p>}
          </div>
        )}
        confirmLabel={reportReview?.action === "VERIFY" ? "Подтвердить данные" : "Отклонить и запросить заново"}
        destructive={reportReview?.action === "REJECT"}
        busy={busy}
        onConfirm={() => void submitReportReview()}
        onOpenChange={(open) => { if (!open && !busy) { setReportReview(null); setReportReviewReason(""); setReportReviewError(""); } }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="Подтвердите решение по заявке"
        description={(
          <div className="space-y-3">
            <p>После подтверждения решение будет отправлено клиенту и изменит статус заявки.</p>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-medium text-amber-950">Проверьте обоснование ниже: клиент увидит этот текст без дополнительного редактирования.</p>
            <dl className="space-y-1.5 rounded-lg bg-neutral-50 p-3 text-foreground">
              <div><dt className="inline text-muted-foreground">Тип: </dt><dd className="inline font-medium">{DECISION_LABELS[decision.type]}</dd></div>
              {creditDecision && (
                <>
                  <div><dt className="inline text-muted-foreground">Продукт: </dt><dd className="inline font-medium">{selectedProduct?.name || d.product_name}</dd></div>
                  <div><dt className="inline text-muted-foreground">Условия: </dt><dd className="inline font-medium">{fmtMoney(Number(decision.amount))} на {decision.term_months} мес., ставка {decision.rate}%</dd></div>
                  <p className="pt-1 text-xs text-muted-foreground">Платёж, переплату и общую выплату сервер рассчитает и сохранит после подтверждения решения.</p>
                </>
              )}
              {decision.type === "MORE_INFO" && <><div><dt className="inline text-muted-foreground">Тип запроса: </dt><dd className="inline font-medium">{MORE_INFO_TYPE_LABELS[decision.request_type]}</dd></div><div><dt className="inline text-muted-foreground">Срок ответа: </dt><dd className="inline font-medium">{decision.due_days} дн.</dd></div>{decision.required_files && <div><dt className="inline text-muted-foreground">Файлы: </dt><dd className="inline font-medium">{decision.required_files}</dd></div>}{decision.required_fields && <div><dt className="inline text-muted-foreground">Поля: </dt><dd className="inline font-medium">{decision.required_fields}</dd></div>}</>}
              <div><dt className="block text-muted-foreground">Обоснование для клиента:</dt><dd className="mt-1 block font-medium whitespace-pre-wrap">{decision.reason}</dd></div>
            </dl>
          </div>
        )}
        confirmLabel="Подтвердить решение"
        destructive={decision.type === "REJECT"}
        busy={busy}
        onConfirm={() => void submitDecision()}
        onOpenChange={setConfirmOpen}
      />
    </div>
  );
}
