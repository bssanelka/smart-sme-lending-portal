import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, fmtDate, fmtMoney, type Application, type AppDocument, type AppEvent, type ChatMessage, type MoreInfoRequest } from "@/lib/api";
import { clearMutationKey, getMutationKey, recoverMutationOutcome } from "@/lib/mutation-recovery";
import { EventLog, OfferCard, StatusBadge, StatusTimeline, TemplateAssistant } from "@/components/widgets";
import {
  ECONOMICS_DISCLOSURE,
  creditTermsSnapshotError,
  paymentTypeLabel,
  resolveCreditTerms,
  validUntilLabel,
} from "@/lib/credit-terms";
import ConfirmDialog from "@/components/ConfirmDialog";
import TermHint from "@/components/TermHint";
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3, Download, FileCheck, FileUp, Loader2, PenLine, RefreshCw, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";

type FullApp = Application & { events: AppEvent[]; documents: AppDocument[]; chat: ChatMessage[] };
type LoadMode = "initial" | "background" | "retry" | "action";
type ConfirmAction = "accept" | "decline" | "sign";
type CriticalAction = ConfirmAction | "acknowledge";
type DocumentTransferMode = "preview" | "download";
type DocumentPreview = { document: AppDocument; text: string };
type DocumentListControls = {
  documentTransfers: Record<number, DocumentTransferMode>;
  documentErrors: Record<number, string>;
  onPreview: (document: AppDocument, trigger: HTMLButtonElement) => void;
  onDownload: (document: AppDocument) => void;
};

const PUBLIC_SCORE_KEYS = new Set(["bki", "overdue", "pdn", "amount_ratio"]);
const MORE_INFO_TYPE_LABELS: Record<MoreInfoRequest["type"], string> = {
  FINANCIALS: "Финансовая отчётность",
  DOCUMENT: "Документы",
  COMMENT: "Пояснение",
  BKI_CONSENT: "Согласие на запрос БКИ",
  COMPANY_DATA: "Сведения о компании",
  SYSTEM_RETRY: "Повтор внешней проверки",
};
const MORE_INFO_STATUS_LABELS: Record<MoreInfoRequest["status"], string> = {
  WAITING_CLIENT: "Ожидает вашего ответа",
  CLIENT_RESPONDED: "Ответ получен",
  RECHECK: "Выполняется повторная проверка",
  CLOSED: "Закрыт",
  CANCELLED: "Отменён",
};
const COMPANY_FIELD_LABELS: Record<string, string> = {
  address: "Юридический адрес",
  head_name: "Руководитель",
  okved_code: "Код ОКВЭД",
  okved_name: "Название вида деятельности",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function valueOrFallback(value: number | null, suffix: string) {
  return value === null ? "Не указано" : `${value.toLocaleString("ru-RU")}${suffix}`;
}

async function documentResponseError(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error) return payload.error;
  } catch {
    // The download endpoint may return a non-JSON infrastructure error.
  }
  return `Не удалось получить документ (ошибка ${response.status})`;
}

function saveDocumentBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "document.txt";
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function calculatorRetryUrl(application: Pick<Application, "amount" | "term_months" | "purpose_category">): string {
  return `/dashboard?${new URLSearchParams({
    tab: "calculator",
    amount: String(application.amount),
    term: String(application.term_months),
    category: application.purpose_category,
  }).toString()}`;
}

function criticalActionApplied(action: CriticalAction, application: FullApp): boolean {
  if (action === "accept") return ["SIGNING", "READY_FOR_ISSUANCE", "ISSUED"].includes(application.status);
  if (action === "decline") return application.status === "DECLINED_BY_CLIENT";
  if (action === "sign") return ["READY_FOR_ISSUANCE", "ISSUED"].includes(application.status) && Boolean(application.signed_at);
  return ["READY_FOR_ISSUANCE", "ISSUED"].includes(application.status)
    || (application.documents.length > 0 && application.documents.every((document) => Boolean(document.acknowledged_at)));
}

export default function ApplicationPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [app, setApp] = useState<FullApp | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [lastSuccessfulLoadAt, setLastSuccessfulLoadAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [unresolvedAction, setUnresolvedAction] = useState<CriticalAction | null>(null);
  const [respond, setRespond] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [bkiConsent, setBkiConsent] = useState(false);
  const [companyData, setCompanyData] = useState<Record<string, string>>({});
  const [documentTransfers, setDocumentTransfers] = useState<Record<number, DocumentTransferMode>>({});
  const [documentErrors, setDocumentErrors] = useState<Record<number, string>>({});
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusDocumentsAfterAcceptRef = useRef(false);
  const [financials, setFinancials] = useState({
    year: String(new Date().getFullYear() - 1),
    revenue: "",
    profit: "",
    own_capital: "",
    monthly_obligations: "",
    comment: "",
  });
  const pollInFlightRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const appliedRequestRef = useRef(0);
  const activeRequestsRef = useRef(0);
  const refreshErrorRef = useRef("");
  const lastSuccessfulStatusRef = useRef<string | null>(null);

  const load = useCallback(async (mode: LoadMode) => {
    if (mode === "background" && pollInFlightRef.current) return false;
    const requestId = ++requestSequenceRef.current;
    if (mode === "initial") {
      setInitialLoading(true);
      setInitialError("");
    } else {
      activeRequestsRef.current += 1;
      setRefreshing(true);
    }
    if (mode === "background") pollInFlightRef.current = true;

    try {
      const next = await api.application(Number(id));
      if (requestId >= appliedRequestRef.current) {
        const statusChangedDuringPolling = mode === "background"
          && lastSuccessfulStatusRef.current !== null
          && lastSuccessfulStatusRef.current !== next.status;
        const connectionRestored = Boolean(refreshErrorRef.current);
        appliedRequestRef.current = requestId;
        setApp(next);
        setLastSuccessfulLoadAt(new Date().toISOString());
        setInitialError("");
        refreshErrorRef.current = "";
        setRefreshError("");
        if (statusChangedDuringPolling) {
          setLiveMessage(`Статус заявки изменён: ${next.status_label || next.status}.`);
        } else if (connectionRestored) {
          setLiveMessage("Связь восстановлена. Данные заявки обновлены.");
        }
        lastSuccessfulStatusRef.current = next.status;
      }
      return next;
    } catch (error) {
      const message = errorMessage(error, "Не удалось загрузить заявку");
      if (mode === "initial") {
        setInitialError(message);
      } else if (requestId >= appliedRequestRef.current) {
        refreshErrorRef.current = message;
        setRefreshError(message);
        setLiveMessage(`Не удалось обновить заявку. ${message}`);
      }
      return null;
    } finally {
      if (mode === "initial") setInitialLoading(false);
      else {
        activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
        setRefreshing(activeRequestsRef.current > 0);
      }
      if (mode === "background") pollInFlightRef.current = false;
    }
  }, [id]);

  useEffect(() => {
    setApp(null);
    setRefreshError("");
    setLastSuccessfulLoadAt(null);
    refreshErrorRef.current = "";
    lastSuccessfulStatusRef.current = null;
    setActionError("");
    setConfirmAction(null);
    setUnresolvedAction(null);
    setRespond("");
    setSelectedFiles([]);
    setBkiConsent(false);
    setCompanyData({});
    setDocumentTransfers({});
    setDocumentErrors({});
    setDocumentPreview(null);
    void load("initial");
  }, [id, load]);

  const applicationStatus = app?.status;
  useEffect(() => {
    if (!applicationStatus || ["ISSUED", "REJECTED", "DECLINED_BY_CLIENT"].includes(applicationStatus)) return;
    const timer = window.setInterval(() => { void load("background"); }, 5000);
    return () => window.clearInterval(timer);
  }, [applicationStatus, load]);

  useEffect(() => {
    if (documentPreview) previewHeadingRef.current?.focus();
  }, [documentPreview]);

  useEffect(() => {
    if (app?.status !== "SIGNING" || !focusDocumentsAfterAcceptRef.current) return;
    focusDocumentsAfterAcceptRef.current = false;
    window.requestAnimationFrame(() => {
      const heading = document.getElementById("signing-documents-title");
      heading?.scrollIntoView({ behavior: "smooth", block: "start" });
      heading?.focus({ preventScroll: true });
    });
  }, [app?.status]);

  const act = async (fn: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      await load("action");
      setLiveMessage(successMessage);
      return true;
    } catch (error) {
      const message = errorMessage(error, "Не удалось выполнить действие");
      setActionError(message);
      setLiveMessage(`Ошибка действия. ${message}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const mutationScope = (action: CriticalAction) => `application:${id}:${action}`;

  const executeCriticalAction = async (
    action: CriticalAction,
    mutate: (key: string) => Promise<unknown>,
    successMessage: string,
    onApplied?: () => void,
  ) => {
    setBusy(true);
    setActionError("");
    const scope = mutationScope(action);
    const key = getMutationKey(scope);
    try {
      await mutate(key);
      clearMutationKey(scope);
      setUnresolvedAction(null);
      setConfirmAction(null);
      setLiveMessage(successMessage);
      if (onApplied) onApplied();
      else await load("action");
      return true;
    } catch (error) {
      const recovery = await recoverMutationOutcome(
        error,
        () => api.application(Number(id)),
        (current) => criticalActionApplied(action, current),
      );
      setConfirmAction(null);
      if (recovery.status === "applied") {
        clearMutationKey(scope);
        setUnresolvedAction(null);
        setApp(recovery.value);
        setLastSuccessfulLoadAt(new Date().toISOString());
        setLiveMessage(successMessage);
        if (onApplied) onApplied();
        return true;
      }
      if (recovery.status === "retry") {
        setUnresolvedAction(null);
        setApp(recovery.value);
        setActionError("Сервер подтвердил, что команда не была применена. Можно безопасно повторить это действие с тем же ключом.");
        return false;
      }
      if (recovery.status === "unresolved") {
        setUnresolvedAction(action);
        setActionError(`Результат команды пока неизвестен. Не повторяйте действие до обновления заявки. ${recovery.error.message}`);
        return false;
      }
      clearMutationKey(scope);
      setUnresolvedAction(null);
      setActionError(recovery.error.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterUnknownOutcome = async () => {
    const next = await load("retry");
    if (!next || !unresolvedAction) return;
    if (criticalActionApplied(unresolvedAction, next)) clearMutationKey(mutationScope(unresolvedAction));
    setUnresolvedAction(null);
    setActionError("");
    setLiveMessage("Результат команды проверен по актуальному состоянию заявки.");
    if (next.status === "DECLINED_BY_CLIENT") nav(calculatorRetryUrl(next));
  };

  if (initialLoading && !app) {
    return <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка заявки…</div>;
  }

  if (!app) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-red-200">
          <CardHeader><CardTitle className="text-lg">Не удалось открыть заявку</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p role="alert" className="text-sm text-red-700">{initialError || "Данные заявки недоступны"}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => void load("initial")}><RefreshCw /> Повторить</Button>
              <Button asChild variant="outline"><Link to="/dashboard">Вернуться в кабинет</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const submitFinancials = (event: FormEvent) => {
    event.preventDefault();
    const request = app.active_more_info_request;
    if (!request || request.type !== "FINANCIALS") return;
    return act(() => api.respondMoreInfo(app.id, request.id, {
      financials: {
        year: Number(financials.year),
        revenue: Number(financials.revenue),
        profit: Number(financials.profit),
        own_capital: Number(financials.own_capital),
        monthly_obligations: Number(financials.monthly_obligations),
        comment: financials.comment.trim(),
      },
    }), "Финансовые данные переданы, повторная проверка запущена.");
  };

  const submitTypedMoreInfo = (request: MoreInfoRequest) => {
    if (request.type === "COMMENT") {
      return act(() => api.respondMoreInfo(app.id, request.id, { comment: respond.trim() }), "Пояснение передано, повторная проверка запущена.");
    }
    if (request.type === "DOCUMENT") {
      return act(() => api.respondMoreInfo(app.id, request.id, {
        comment: respond.trim() || undefined,
        files: selectedFiles.map((file) => ({ name: file.name, size: file.size, type: file.type })),
      }), "Сведения о документах переданы, повторная проверка запущена.");
    }
    if (request.type === "BKI_CONSENT") {
      return act(() => api.respondMoreInfo(app.id, request.id, { consent: bkiConsent }), "Согласие подтверждено, повторная проверка запущена.");
    }
    if (request.type === "COMPANY_DATA") {
      return act(() => api.respondMoreInfo(app.id, request.id, { company_data: companyData }), "Сведения о компании переданы, повторная проверка запущена.");
    }
  };

  const publicScoreDetails = app.score_details?.filter((factor) => PUBLIC_SCORE_KEYS.has(factor.key)) ?? [];
  const publicEvents = app.events.map((event) => event.to_status === "DECISION"
    ? { ...event, comment: "Автоматическая предварительная оценка завершена, заявка передана сотруднику банка" }
    : event);
  const retryUrl = calculatorRetryUrl(app);
  const openedDocumentsCount = app.documents.filter((document) => Boolean(document.opened_at)).length;
  const allDocumentsOpened = app.documents.length > 0 && openedDocumentsCount === app.documents.length;
  const allDocumentsAcknowledged = app.documents.length > 0 && app.documents.every((document) => Boolean(document.acknowledged_at));
  const activeMoreInfoRequest = app.active_more_info_request ?? null;

  const transferDocument = async (appDocument: AppDocument, mode: DocumentTransferMode) => {
    if (documentTransfers[appDocument.id]) return;
    setDocumentTransfers((current) => ({ ...current, [appDocument.id]: mode }));
    setDocumentErrors((current) => {
      const next = { ...current };
      delete next[appDocument.id];
      return next;
    });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(api.documentDownloadUrl(appDocument.id), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "text/plain" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await documentResponseError(response));
      const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("text/plain")) throw new Error("Сервер вернул документ в неожиданном формате");

      const blob = await response.blob();
      if (mode === "preview") {
        setDocumentPreview({ document: appDocument, text: await blob.text() });
      } else {
        saveDocumentBlob(blob, appDocument.filename);
      }

      const refreshed = await load("action");
      if (refreshed) {
        setLiveMessage(`${mode === "preview" ? "Предпросмотр открыт" : "Документ скачан"}. Серверное состояние заявки обновлено.`);
      } else {
        setLiveMessage(`${mode === "preview" ? "Предпросмотр открыт" : "Документ скачан"}, но актуальное состояние заявки пока не получено.`);
      }
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Сервер не ответил вовремя. Текущее состояние заявки сохранено."
        : errorMessage(error, "Не удалось получить документ");
      setDocumentErrors((current) => ({ ...current, [appDocument.id]: message }));
      setLiveMessage(`Не удалось получить документ «${appDocument.kind}». ${message}`);
    } finally {
      window.clearTimeout(timeout);
      setDocumentTransfers((current) => {
        const next = { ...current };
        delete next[appDocument.id];
        return next;
      });
    }
  };

  const showDocumentPreview = (appDocument: AppDocument, trigger: HTMLButtonElement) => {
    previewTriggerRef.current = trigger;
    void transferDocument(appDocument, "preview");
  };

  const closeDocumentPreview = () => {
    setDocumentPreview(null);
    window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
  };

  const documentListControls: DocumentListControls = {
    documentTransfers,
    documentErrors,
    onPreview: showDocumentPreview,
    onDownload: (appDocument) => { void transferDocument(appDocument, "download"); },
  };

  const acknowledgeDocuments = () => executeCriticalAction(
    "acknowledge",
    (key) => api.acknowledgeDocuments(app.id, key),
    "Ознакомление с полным пакетом подтверждено на сервере.",
  );

  const runConfirmedAction = async () => {
    if (confirmAction === "accept") {
      focusDocumentsAfterAcceptRef.current = true;
      const applied = await executeCriticalAction("accept", (key) => api.accept(app.id, key), "Предложение принято. Документы сформированы и доступны ниже.");
      if (!applied) focusDocumentsAfterAcceptRef.current = false;
      return;
    }
    if (confirmAction === "sign") {
      await executeCriticalAction("sign", (key) => api.sign(app.id, key), "Demo-подписание завершено. Подписанный пакет передан банку для отдельного подтверждения выдачи.");
      return;
    }
    if (confirmAction === "decline") {
      await executeCriticalAction("decline", (key) => api.decline(app.id, key), "Предложение отклонено. Открыт новый расчёт.", () => nav(retryUrl));
    }
  };

  const confirmation = confirmAction ? {
    accept: {
      title: "Принять предложение банка?",
      description: <OfferConfirmationDetails app={app} />,
      confirmLabel: "Да, принять",
      destructive: false,
    },
    decline: {
      title: "Отклонить предложение?",
      description: "Текущая заявка будет завершена, а вы перейдёте к новому расчёту. Вернуть это предложение после подтверждения нельзя.",
      confirmLabel: "Отклонить предложение",
      destructive: true,
    },
    sign: {
      title: "Подтвердить demo-подписание?",
      description: <div className="space-y-3"><p>Заявка <b>{app.public_no}</b>. Будет подписан следующий серверно подтверждённый пакет:</p><ul className="list-disc space-y-1 pl-5">{app.documents.map((document) => <li key={document.id}>{document.kind} · версия {document.document_version}</li>)}</ul><p>Это демонстрационное действие: оно не создаёт юридически значимую электронную подпись и не выполняет реальное перечисление средств.</p></div>,
      confirmLabel: "Подтвердить demo-подписание",
      destructive: false,
    },
  }[confirmAction] : null;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>
      <header className="border-b bg-white">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4" /> Кабинет</Link>
          </Button>
          <span className="font-bold">{app.product_name}</span>
          <span className="text-sm text-muted-foreground">{app.public_no}</span>
          <StatusBadge status={app.status} label={app.status_label} />
          {!['ISSUED', 'REJECTED', 'DECLINED_BY_CLIENT'].includes(app.status) && (
            <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={refreshing || busy} onClick={() => void (unresolvedAction ? refreshAfterUnknownOutcome() : load("retry"))}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Обновить
            </Button>
          )}
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {refreshError && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
            <div>
              <p className="font-semibold">Не удалось получить свежие данные</p>
              <p className="mt-1">Показаны данные, успешно загруженные {lastSuccessfulLoadAt ? fmtDate(lastSuccessfulLoadAt) : "ранее"}. {refreshError}</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void (unresolvedAction ? refreshAfterUnknownOutcome() : load("retry"))}>
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Повторить
            </Button>
          </div>
        )}

        {actionError && (app.status !== "OFFER" || unresolvedAction) && (
          <div role="alert" className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${unresolvedAction ? "border-amber-300 bg-amber-50 text-amber-950" : "border-red-300 bg-red-50 text-red-800"}`}>
            <div><p className="font-semibold">{unresolvedAction ? "Результат действия требует проверки" : "Действие не выполнено"}</p><p className="mt-1">{actionError}</p></div>
            {unresolvedAction
              ? <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void refreshAfterUnknownOutcome()}><RefreshCw className="h-4 w-4" /> Проверить результат</Button>
              : <Button type="button" size="sm" variant="outline" onClick={() => setActionError("")}>Закрыть</Button>}
          </div>
        )}

        {documentPreview && (
          <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm" aria-labelledby="document-preview-title">
            <div className="flex flex-col gap-3 border-b border-blue-100 bg-blue-50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 id="document-preview-title" ref={previewHeadingRef} tabIndex={-1} className="font-semibold text-blue-950 outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                  Предпросмотр: {documentPreview.document.kind}
                </h2>
                <p className="mt-1 break-all text-xs text-blue-900">Текстовый демонстрационный документ · {documentPreview.document.filename}</p>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                <Button type="button" size="sm" variant="outline" disabled={Boolean(documentTransfers[documentPreview.document.id])} onClick={() => void transferDocument(documentPreview.document, "download")} aria-label={`Скачать файл документа «${documentPreview.document.kind}»`}>
                  {documentTransfers[documentPreview.document.id] === "download" ? <Loader2 className="animate-spin" /> : <Download />} Скачать файл
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={closeDocumentPreview}>Закрыть</Button>
              </div>
            </div>
            <div className="max-h-[28rem] overflow-auto p-4 sm:p-5" tabIndex={0} aria-label={`Содержимое документа «${documentPreview.document.kind}»`}>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-neutral-800 sm:text-sm">{documentPreview.text}</pre>
            </div>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <CardContent className="pt-6"><StatusTimeline app={app} /></CardContent>
            </Card>

            {app.status === "DECISION" && app.preapproval && (
              <Card className={app.preapproval.status === "PREAPPROVED" ? "border-blue-300 bg-blue-50/60" : "border-amber-300 bg-amber-50/60"}>
                <CardContent className="flex gap-3 pt-6">
                  {app.preapproval.status === "PREAPPROVED" ? <ShieldCheck className="h-6 w-6 shrink-0 text-blue-700" /> : <CircleAlert className="h-6 w-6 shrink-0 text-amber-700" />}
                  <div>
                    <p className="font-semibold">{app.preapproval.label}<TermHint term="preapproval" /></p>
                    <p className="mt-1 text-sm text-muted-foreground">{app.preapproval.description}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <OfferCard app={app} busy={busy || Boolean(unresolvedAction)} actionError={unresolvedAction ? "" : actionError} onAction={(action) => { setActionError(""); setConfirmAction(action); }} />

            {["SIGNING", "READY_FOR_ISSUANCE"].includes(app.status) && <ApprovedTermsSummary app={app} />}

            {app.status === "SIGNING" && (
              <Card className="border-green-300 bg-green-50/50">
                <CardHeader className="pb-2"><CardTitle id="signing-documents-title" tabIndex={-1} className="text-base text-green-800 outline-none focus-visible:ring-2 focus-visible:ring-green-700">Предложение принято — документы готовы</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-green-950">Банк сформировал пакет по утверждённым условиям. Ознакомьтесь с каждым документом перед demo-подписанием.</p>
                  <DocList docs={app.documents} {...documentListControls} />
                  <div className="rounded-lg border border-green-200 bg-white p-3" aria-labelledby="document-progress-label">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span id="document-progress-label" className="font-medium text-green-950">Документы открыты</span>
                      <strong className="tabular-nums text-green-950">{openedDocumentsCount}/{app.documents.length}</strong>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-green-100" role="progressbar" aria-labelledby="document-progress-label" aria-valuemin={0} aria-valuemax={app.documents.length} aria-valuenow={openedDocumentsCount} aria-valuetext={`${openedDocumentsCount} из ${app.documents.length}`}>
                      <div className="h-full rounded-full bg-green-700 transition-[width]" style={{ width: `${app.documents.length > 0 ? (openedDocumentsCount / app.documents.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                  {!allDocumentsOpened && <p className="text-xs text-amber-800">Откройте предпросмотр или скачайте файл каждого документа. Прогресс изменится только после успешной серверной фиксации и автоматического обновления заявки.</p>}
                  {allDocumentsOpened && !allDocumentsAcknowledged && (
                    <Button type="button" variant="outline" className="w-full whitespace-normal" disabled={busy || Boolean(unresolvedAction)} onClick={() => void acknowledgeDocuments()}>
                      {busy ? <Loader2 className="animate-spin" /> : <FileCheck />} Подтвердить ознакомление со всем пакетом
                    </Button>
                  )}
                  {allDocumentsAcknowledged && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-white p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Ознакомление подтверждено на сервере. Пакет готов к demo-подписанию.</span></div>}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-semibold">Только демонстрация</p>
                    <p className="mt-1">Подписание в прототипе не является юридически значимым, не использует реальную электронную подпись и не приводит к фактическому перечислению средств.</p>
                  </div>
                  <Button className="w-full whitespace-normal" disabled={busy || Boolean(unresolvedAction) || !allDocumentsOpened || !allDocumentsAcknowledged} onClick={() => { setActionError(""); setConfirmAction("sign"); }}>
                    {busy ? <Loader2 className="animate-spin" /> : <PenLine />} Подтвердить только demo-подписание
                  </Button>
                </CardContent>
              </Card>
            )}

            {app.status === "READY_FOR_ISSUANCE" && (
              <Card className="border-cyan-300 bg-cyan-50/60">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base text-cyan-950"><Clock3 className="h-5 w-5" /> Документы подписаны — ожидается выдача</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm text-cyan-950">
                  <p>Ваше demo-подписание зафиксировано {app.signed_at ? fmtDate(app.signed_at) : "на сервере"}. Клиентская часть завершена.</p>
                  <p>Следующий шаг выполняет сотрудник банка: отдельной командой подтверждает модельную выдачу. Реальное движение денег в прототипе не выполняется.</p>
                  <DocList docs={app.documents} {...documentListControls} />
                </CardContent>
              </Card>
            )}

            {app.status === "ISSUED" && <IssuedSummary app={app} retryUrl={retryUrl} documentListControls={documentListControls} />}

            {app.status === "MORE_INFO" && (
              <Card className="border-orange-300">
                <CardHeader className="pb-2"><CardTitle className="text-base">Запрос дополнительной информации</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {!activeMoreInfoRequest ? (
                    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Структура запроса недоступна. Не отправляйте данные вслепую — обновите заявку или обратитесь в банк.</p>
                  ) : (
                    <>
                      <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge className="bg-orange-100 text-orange-900">{MORE_INFO_TYPE_LABELS[activeMoreInfoRequest.type]}</Badge>
                          <span className="flex items-center gap-1 text-xs text-orange-900"><Clock3 className="h-3.5 w-3.5" /> {activeMoreInfoRequest.type === "SYSTEM_RETRY" ? "Повтор выполняет банк" : `Ответ до ${fmtDate(activeMoreInfoRequest.dueAt)}`}</span>
                        </div>
                        <p className="mt-3 text-sm font-medium">{activeMoreInfoRequest.reason}</p>
                        {activeMoreInfoRequest.requiredFields.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Обязательные сведения: {activeMoreInfoRequest.requiredFields.map((field) => COMPANY_FIELD_LABELS[field] || field).join(", ")}.</p>}
                        {activeMoreInfoRequest.requiredFiles.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Обязательные файлы: {activeMoreInfoRequest.requiredFiles.join(", ")}.</p>}
                      </div>

                      {activeMoreInfoRequest.type === "SYSTEM_RETRY" && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                          <p className="font-semibold">От вас ничего не требуется</p>
                          <p className="mt-1">Банк самостоятельно повторит запрос во внешнюю систему. Недоступность БКИ или реестра не нужно исправлять клиенту.</p>
                        </div>
                      )}

                      {activeMoreInfoRequest.type === "FINANCIALS" && (
                        <form onSubmit={submitFinancials} className="space-y-4" aria-label="Финансовые данные компании">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5"><Label htmlFor="financial-year">Отчётный год</Label><Input id="financial-year" type="number" min={new Date().getFullYear() - 1} max={new Date().getFullYear()} value={financials.year} onChange={(event) => setFinancials((current) => ({ ...current, year: event.target.value }))} required /></div>
                            <div className="space-y-1.5"><Label htmlFor="financial-revenue">Выручка за год, ₽</Label><Input id="financial-revenue" type="number" min="0" step="1" value={financials.revenue} onChange={(event) => setFinancials((current) => ({ ...current, revenue: event.target.value }))} required /></div>
                            <div className="space-y-1.5"><Label htmlFor="financial-profit">Прибыль за год, ₽</Label><Input id="financial-profit" type="number" step="1" value={financials.profit} onChange={(event) => setFinancials((current) => ({ ...current, profit: event.target.value }))} required /></div>
                            <div className="space-y-1.5"><Label htmlFor="financial-capital">Собственный капитал, ₽</Label><Input id="financial-capital" type="number" min="0" step="1" value={financials.own_capital} onChange={(event) => setFinancials((current) => ({ ...current, own_capital: event.target.value }))} required /></div>
                            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="financial-obligations">Ежемесячные обязательства, ₽</Label><Input id="financial-obligations" type="number" min="0" step="1" value={financials.monthly_obligations} onChange={(event) => setFinancials((current) => ({ ...current, monthly_obligations: event.target.value }))} required /></div>
                            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="financial-comment">Комментарий</Label><Textarea id="financial-comment" value={financials.comment} onChange={(event) => setFinancials((current) => ({ ...current, comment: event.target.value }))} placeholder="Укажите источник данных или важные пояснения" /></div>
                          </div>
                          <Button type="submit" className="w-full whitespace-normal" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Передать отчётность и повторить проверку</Button>
                        </form>
                      )}

                      {activeMoreInfoRequest.type === "COMMENT" && (
                        <div className="space-y-3">
                          <Label htmlFor="more-info-comment">Пояснение для банка</Label>
                          <Textarea id="more-info-comment" value={respond} onChange={(event) => setRespond(event.target.value)} placeholder="Ответьте именно на указанный выше вопрос" />
                          <Button className="w-full" disabled={busy || respond.trim().length < 3} onClick={() => void submitTypedMoreInfo(activeMoreInfoRequest)}>{busy && <Loader2 className="animate-spin" />} Отправить пояснение</Button>
                        </div>
                      )}

                      {activeMoreInfoRequest.type === "DOCUMENT" && (
                        <div className="space-y-3">
                          <Label htmlFor="more-info-files">Выберите документы</Label>
                          <Input id="more-info-files" type="file" multiple onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} />
                          {selectedFiles.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground">{selectedFiles.map((file) => <li key={`${file.name}-${file.size}`} className="flex items-center gap-1"><FileUp className="h-3.5 w-3.5" /> {file.name} · {Math.ceil(file.size / 1024)} КБ</li>)}</ul>}
                          <Label htmlFor="document-comment">Комментарий к документам — необязательно</Label>
                          <Textarea id="document-comment" value={respond} onChange={(event) => setRespond(event.target.value)} placeholder="Укажите пояснение к выбранным документам" />
                          <p className="text-xs text-muted-foreground">В демонстрации сохраняются метаданные выбранных файлов; содержимое не передаётся во внешние системы.</p>
                          <Button className="w-full" disabled={busy || selectedFiles.length < activeMoreInfoRequest.requiredFiles.length || selectedFiles.length === 0} onClick={() => void submitTypedMoreInfo(activeMoreInfoRequest)}>{busy && <Loader2 className="animate-spin" />} Передать документы</Button>
                        </div>
                      )}

                      {activeMoreInfoRequest.type === "BKI_CONSENT" && (
                        <div className="space-y-3">
                          <label className="flex items-start gap-3 rounded-lg border bg-white p-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#EF3124]" checked={bkiConsent} onChange={(event) => setBkiConsent(event.target.checked)} /><span>Я подтверждаю демонстрационное согласие на запрос кредитной истории компании в БКИ.</span></label>
                          <Button className="w-full" disabled={busy || !bkiConsent} onClick={() => void submitTypedMoreInfo(activeMoreInfoRequest)}>{busy && <Loader2 className="animate-spin" />} Подтвердить согласие</Button>
                        </div>
                      )}

                      {activeMoreInfoRequest.type === "COMPANY_DATA" && (
                        <div className="space-y-3">
                          {activeMoreInfoRequest.requiredFields.map((field) => (
                            <div key={field} className="space-y-1.5"><Label htmlFor={`company-${field}`}>{COMPANY_FIELD_LABELS[field] || field}</Label><Input id={`company-${field}`} value={companyData[field] || ""} onChange={(event) => setCompanyData((current) => ({ ...current, [field]: event.target.value }))} required /></div>
                          ))}
                          <Button className="w-full" disabled={busy || activeMoreInfoRequest.requiredFields.some((field) => !companyData[field]?.trim())} onClick={() => void submitTypedMoreInfo(activeMoreInfoRequest)}>{busy && <Loader2 className="animate-spin" />} Передать сведения о компании</Button>
                        </div>
                      )}
                    </>
                  )}

                  {(app.more_info_requests?.length ?? 0) > 1 && (
                    <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">История запросов</summary><div className="mt-3 space-y-2">{app.more_info_requests!.map((request) => <div key={request.id} className="rounded-lg border p-3 text-xs"><p className="font-medium">{MORE_INFO_TYPE_LABELS[request.type]} · {MORE_INFO_STATUS_LABELS[request.status]}</p><p className="mt-1 text-muted-foreground">{request.reason}</p></div>)}</div></details>
                  )}
                </CardContent>
              </Card>
            )}

            {app.documents.length > 0 && !["SIGNING", "READY_FOR_ISSUANCE", "ISSUED"].includes(app.status) && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Документы</CardTitle></CardHeader>
                <CardContent><DocList docs={app.documents} {...documentListControls} /></CardContent>
              </Card>
            )}

            {["REJECTED", "DECLINED_BY_CLIENT"].includes(app.status) && (
              <Card className={app.status === "REJECTED" ? "border-red-200" : "border-neutral-300"}>
                <CardHeader className="pb-2"><CardTitle className="text-base">{app.status === "REJECTED" ? "Решение банка и следующий шаг" : "Предложение отклонено"}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {app.status === "REJECTED" ? (
                    <div className="rounded-lg border bg-neutral-50 p-3 text-sm"><p className="font-semibold">Комментарий банка</p><p className="mt-1 text-muted-foreground">{app.decision?.reason || "Комментарий не указан"}</p></div>
                  ) : <p className="text-sm">Исходная заявка сохранена в истории. Можно вернуться к потребности и получить новый автоматический подбор.</p>}
                  <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                    Система заново проверит подходящие продукты и может предложить другую сумму или срок. Старая заявка останется без изменений.
                  </div>
                  <Button asChild><Link to={retryUrl}><RotateCcw /> Подобрать другое предложение</Link></Button>
                </CardContent>
              </Card>
            )}

            {publicScoreDetails.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Публичные факторы оценки заявки</CardTitle></CardHeader>
                <CardContent>
                  <div className="divide-y">
                    {publicScoreDetails.map((factor) => (
                      <div key={factor.key} className="py-3 text-sm">
                        <p className="font-medium">{factor.label}{factor.key === "bki" && <TermHint term="bki" />}{factor.key === "pdn" && <TermHint term="pdn" />}: <span className="font-normal text-muted-foreground">{factor.value}</span></p>
                        <p className="mt-1 text-xs text-muted-foreground">{factor.explanation}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Показаны только понятные клиенту параметры без внутренних баллов и служебной оценки банка.</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">История обработки</CardTitle></CardHeader>
              <CardContent><EventLog events={publicEvents} /></CardContent>
            </Card>
          </div>

          <div><TemplateAssistant applicationId={app.id} initial={app.chat} /></div>
        </div>
      </main>

      {confirmation && (
        <ConfirmDialog
          open={confirmAction !== null}
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          destructive={confirmation.destructive}
          busy={busy}
          error={actionError}
          onConfirm={() => void runConfirmedAction()}
          onOpenChange={(open) => { if (!open && !busy) setConfirmAction(null); }}
        />
      )}
    </div>
  );
}

function OfferConfirmationDetails({ app }: { app: Application }) {
  const terms = resolveCreditTerms(app.decision);
  const items = [
    ["Продукт", app.decision?.productName || app.product_name || "Не указан"],
    ["Основной долг", fmtMoney(terms.amount)],
    ["Срок", valueOrFallback(terms.termMonths, " мес.")],
    ["Номинальная ставка", valueOrFallback(terms.rate, "% годовых")],
    ["Ежемесячный платёж", fmtMoney(terms.monthlyPayment)],
    ["Переплата", fmtMoney(terms.overpayment)],
    ["Общая выплата", fmtMoney(terms.totalPayment)],
    ["Тип платежа", paymentTypeLabel(app.decision?.paymentType)],
    ["Предложение действительно", validUntilLabel(app.decision?.validUntil)],
    ["Комиссии", app.decision?.feesIncluded === false ? "Не моделируются и не включены" : "Данные не указаны"],
  ];
  const snapshotError = creditTermsSnapshotError(app.decision);

  return (
    <div className="space-y-3">
      <p>После подтверждения банк сформирует пакет документов по этим финальным условиям:</p>
      <dl className="grid gap-2 rounded-lg border bg-neutral-50 p-3 sm:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`font-semibold text-foreground ${label === "Предложение действительно" ? "whitespace-nowrap" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-950">{ECONOMICS_DISCLOSURE}</p>
      {snapshotError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Ошибка данных предложения: {snapshotError}</p>}
    </div>
  );
}

function ApprovedTermsSummary({ app }: { app: Application }) {
  const terms = resolveCreditTerms(app.decision);
  const items = [
    ["Продукт", app.decision?.productName || app.product_name || "Не указан"],
    ["Основной долг", fmtMoney(terms.amount)],
    ["Ставка", valueOrFallback(terms.rate, "%")],
    ["Срок", valueOrFallback(terms.termMonths, " мес.")],
    ["Платёж в месяц", fmtMoney(terms.monthlyPayment)],
    ["Переплата", fmtMoney(terms.overpayment)],
    ["Общая выплата", fmtMoney(terms.totalPayment)],
  ];

  return (
    <Card className="border-blue-200 bg-blue-50/40">
      <CardHeader className="pb-2"><CardTitle className="text-base text-blue-950">Утверждённые условия</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-bold">{value}</dd></div>)}
          <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Тип платежа</dt><dd className="mt-1 font-bold">{paymentTypeLabel(app.decision?.paymentType)}</dd></div>
          <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Предложение действительно до</dt><dd className="mt-1 whitespace-nowrap font-bold">{validUntilLabel(app.decision?.validUntil)}</dd></div>
          <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Комиссии</dt><dd className="mt-1 font-bold">{app.decision?.feesIncluded === false ? "Не моделируются и не включены" : "Данные не указаны"}</dd></div>
        </dl>
        {app.decision?.reason && <div className="rounded-lg border bg-white p-3 text-sm"><p className="font-semibold">Комментарий банка</p><p className="mt-1 text-muted-foreground">{app.decision.reason}</p></div>}
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-950">{ECONOMICS_DISCLOSURE}</p>
        {creditTermsSnapshotError(app.decision) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Ошибка данных утверждённых условий: {creditTermsSnapshotError(app.decision)}</p>}
      </CardContent>
    </Card>
  );
}

function IssuedSummary({ app, retryUrl, documentListControls }: { app: FullApp; retryUrl: string; documentListControls: DocumentListControls }) {
  const terms = resolveCreditTerms(app.decision);
  const issuedEvent = [...app.events].reverse().find((event) => event.to_status === "ISSUED");
  const issuanceDate = app.issued_at || issuedEvent?.created_at || app.updated_at;
  const signingDate = app.signed_at || signedDocumentsDate(app.documents) || issuanceDate;
  const signedDocuments = app.documents.filter((document) => document.status === "SIGNED");
  const issuanceLabel = app.issuance_mode === "BANK_CONFIRMED"
    ? "Отдельно подтверждена сотрудником банка"
    : app.issuance_mode === "LEGACY_COMBINED"
      ? "Перенесена из прежнего объединённого demo-сценария"
      : "Режим подтверждения не указан";

  return (
    <Card className="overflow-hidden border-emerald-300 bg-emerald-50/50">
      <CardHeader className="border-b border-emerald-200 bg-emerald-700 text-white">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0" />
          <div><CardTitle className="text-xl">Модельная выдача подтверждена</CardTitle><p className="mt-1 text-sm text-emerald-50">Demo-сценарий успешно завершён сотрудником банка</p></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Номер заявки</p><p className="mt-1 font-bold">{app.public_no}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Продукт</p><p className="mt-1 font-bold">{app.decision?.productName || app.product_name || "Не указан"}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Demo-подписание клиента</p><p className="mt-1 font-bold">{fmtDate(signingDate)}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Подтверждение выдачи банком</p><p className="mt-1 font-bold">{fmtDate(issuanceDate)}</p></div>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-white p-3 text-sm">
          <p className="font-semibold">{app.issuance_mode === "LEGACY_COMBINED" ? "Историческая запись выдачи сохранена" : "Два отдельных действия зафиксированы"}</p>
          {app.issuance_mode === "LEGACY_COMBINED"
            ? <p className="mt-1 text-muted-foreground">Эта заявка была завершена до разделения этапов. Исторически подписание и выдача фиксировались одной командой; доступные времена восстановлены без переписывания событий. Режим фиксации: {issuanceLabel}.</p>
            : <p className="mt-1 text-muted-foreground">Клиент подтвердил demo-подписание, после чего сотрудник банка отдельно подтвердил модельную выдачу. Режим фиксации: {issuanceLabel}.</p>}
        </div>

        <div>
          <h3 className="flex items-center gap-2 font-semibold"><WalletCards className="h-5 w-5 text-emerald-700" /> Итоговые условия</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Основной долг</dt><dd className="mt-1 font-bold">{fmtMoney(terms.amount)}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Ставка</dt><dd className="mt-1 font-bold">{valueOrFallback(terms.rate, "%")}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Срок</dt><dd className="mt-1 font-bold">{valueOrFallback(terms.termMonths, " мес.")}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Платёж в месяц</dt><dd className="mt-1 font-bold">{fmtMoney(terms.monthlyPayment)}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Переплата</dt><dd className="mt-1 font-bold">{fmtMoney(terms.overpayment)}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Общая выплата</dt><dd className="mt-1 font-bold">{fmtMoney(terms.totalPayment)}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Тип платежа</dt><dd className="mt-1 font-bold">{paymentTypeLabel(app.decision?.paymentType)}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Предложение действительно</dt><dd className="mt-1 font-bold">{validUntilLabel(app.decision?.validUntil)}</dd></div>
            <div className="rounded-lg border bg-white p-3"><dt className="text-xs text-muted-foreground">Комиссии</dt><dd className="mt-1 font-bold">{app.decision?.feesIncluded === false ? "Не моделируются и не включены" : "Данные не указаны"}</dd></div>
          </dl>
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">{ECONOMICS_DISCLOSURE}</p>
          {creditTermsSnapshotError(app.decision) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Ошибка данных итоговых условий: {creditTermsSnapshotError(app.decision)}</p>}
        </div>

        <div>
          <h3 className="font-semibold">Подписанные документы</h3>
          {signedDocuments.length > 0 ? <div className="mt-3"><DocList docs={signedDocuments} {...documentListControls} /></div> : <p className="mt-2 text-sm text-muted-foreground">Статусы подписанных документов не были сохранены в этой заявке.</p>}
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Demo-результат, не банковская операция</p>
          <p className="mt-1">Экран моделирует выдачу. Юридически значимое подписание и реальное перечисление средств не выполнялись.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild className="flex-1"><Link to="/dashboard"><ArrowLeft /> Кабинет</Link></Button>
          <Button asChild variant="outline" className="flex-1"><Link to={retryUrl}><RotateCcw /> Новый расчёт</Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function signedDocumentsDate(documents: AppDocument[]): string | null {
  return documents.find((document) => document.status === "SIGNED" && document.signed_at)?.signed_at ?? null;
}

function documentStatusLabel(status: string) {
  if (status === "SIGNED") return "Подписан";
  if (status === "GENERATED") return "Сформирован";
  return "Загружен";
}

function significantDocumentDate(document: AppDocument) {
  if (document.signed_at) return { label: "Подписан", value: document.signed_at };
  if (document.acknowledged_at) return { label: "Ознакомление подтверждено", value: document.acknowledged_at };
  if (document.opened_at) return { label: "Открыт", value: document.opened_at };
  return { label: "Сформирован", value: document.created_at };
}

function DocList({ docs, documentTransfers, documentErrors, onPreview, onDownload }: { docs: AppDocument[] } & DocumentListControls) {
  return (
    <div className="space-y-2">
      {docs.map((document) => {
        const transfer = documentTransfers[document.id];
        const errorId = `document-${document.id}-error`;
        const significantDate = significantDocumentDate(document);
        return (
          <div key={document.id} className="rounded-lg border bg-white px-3 py-3 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="break-words font-semibold">{document.kind}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{significantDate.label}: <span className="whitespace-nowrap font-medium text-foreground">{fmtDate(significantDate.value)}</span></p>
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                <Badge variant={document.status === "SIGNED" ? "default" : "secondary"} className={document.status === "SIGNED" ? "bg-emerald-700" : ""}>{documentStatusLabel(document.status)}</Badge>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                  <Button type="button" size="sm" variant="outline" className="w-full" disabled={Boolean(transfer)} aria-label={`Открыть текстовый предпросмотр документа «${document.kind}»`} aria-describedby={documentErrors[document.id] ? errorId : undefined} onClick={(event) => onPreview(document, event.currentTarget)}>
                    {transfer === "preview" ? <Loader2 className="animate-spin" /> : <FileCheck />} Просмотреть
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="w-full" disabled={Boolean(transfer)} aria-label={`Скачать файл документа «${document.kind}»`} aria-describedby={documentErrors[document.id] ? errorId : undefined} onClick={() => onDownload(document)}>
                    {transfer === "download" ? <Loader2 className="animate-spin" /> : <Download />} Скачать файл
                  </Button>
                </div>
              </div>
            </div>
            <details className="mt-3 border-t pt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Сведения о документе</summary>
              <div className="mt-3 grid gap-3 rounded-lg bg-neutral-50 p-3 text-xs sm:grid-cols-2">
                <div><p className="text-muted-foreground">Файл</p><p className="mt-1 break-all font-medium">{document.filename}</p></div>
                <div><p className="text-muted-foreground">Версия</p><p className="mt-1 font-medium">{document.document_version || "Не указана"}</p></div>
                <div className="sm:col-span-2"><p className="text-muted-foreground">SHA-256</p><p className="mt-1 break-all font-mono">{document.content_hash || "Не указан"}</p></div>
                <div className="sm:col-span-2">
                  <p className="font-medium">История</p>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    <li>Сформирован: <span className="whitespace-nowrap text-foreground">{fmtDate(document.created_at)}</span></li>
                    {document.opened_at && <li>Открыт: <span className="whitespace-nowrap text-foreground">{fmtDate(document.opened_at)}</span></li>}
                    {document.acknowledged_at && <li>Ознакомление подтверждено: <span className="whitespace-nowrap text-foreground">{fmtDate(document.acknowledged_at)}</span></li>}
                    {document.signed_at && <li>Подписан: <span className="whitespace-nowrap text-foreground">{fmtDate(document.signed_at)}</span></li>}
                  </ul>
                </div>
              </div>
            </details>
            {documentErrors[document.id] && <p id={errorId} role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{documentErrors[document.id]}</p>}
          </div>
        );
      })}
    </div>
  );
}
