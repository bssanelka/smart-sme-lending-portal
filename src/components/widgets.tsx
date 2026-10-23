import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, fmtMoney, api, STATUS_COLORS, type AppEvent, type Application, type ScoreFactor } from "@/lib/api";
import {
  ECONOMICS_DISCLOSURE,
  creditTermsSnapshotError,
  paymentTypeLabel,
  resolveCreditTerms,
  validUntilLabel,
  type ResolvedCreditTerms,
} from "@/lib/credit-terms";
import TermHint from "@/components/TermHint";
import { Bot, Check, Landmark, Loader2, Send, Shuffle, X } from "lucide-react";

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge className={`${STATUS_COLORS[status] || "bg-gray-100 text-gray-800"} whitespace-nowrap`}>{label || status}</Badge>;
}

// Клиентский путь объединяет технический ENRICHMENT с проверкой данных.
const FLOW = [
  { key: "SUBMITTED", label: "Заявка подана" },
  { key: "DATA_CHECK", label: "Проверка данных" },
  { key: "SCORING", label: "Предварительная оценка" },
  { key: "DECISION", label: "Рассмотрение сотрудником" },
  { key: "OFFER", label: "Предложение" },
  { key: "DOCUMENTS", label: "Документы" },
  { key: "SIGNING", label: "Подписание" },
  { key: "READY_FOR_ISSUANCE", label: "Проверка выдачи" },
  { key: "ISSUED", label: "Выдача" },
] as const;

const STATUS_STAGE: Record<string, number> = {
  SUBMITTED: 0,
  DATA_CHECK: 1,
  ENRICHMENT: 1,
  SCORING: 2,
  DECISION: 3,
  OFFER: 4,
  DOCUMENTS: 5,
  SIGNING: 6,
  READY_FOR_ISSUANCE: 7,
  ISSUED: 8,
};

const BRANCHES: Record<string, { label: string; message: string; className: string }> = {
  MORE_INFO: {
    label: "Нужно уточнение",
    message: "Банк запросил дополнительные данные. Основной путь продолжится после вашего ответа.",
    className: "border-orange-200 bg-orange-50 text-orange-800",
  },
  REJECTED: {
    label: "Отказ банка",
    message: "Рассмотрение завершено отказом. Причина и доступный следующий шаг указаны ниже.",
    className: "border-red-200 bg-red-50 text-red-800",
  },
  DECLINED_BY_CLIENT: {
    label: "Предложение отклонено",
    message: "Вы отказались от предложения. Заявка сохранена в истории.",
    className: "border-neutral-200 bg-neutral-100 text-neutral-700",
  },
};

const STATUS_GUIDANCE: Record<string, { actor: string; action: string; next: string }> = {
  SUBMITTED: { actor: "Банк", action: "Ничего — заявка уже принята", next: "Банк проверит полноту данных" },
  DATA_CHECK: { actor: "Банк", action: "Дождаться результата проверки", next: "Предварительная оценка заявки" },
  ENRICHMENT: { actor: "Банк", action: "Дождаться ответа внешних источников", next: "Предварительная оценка заявки" },
  SCORING: { actor: "Банк", action: "Дождаться расчёта", next: "Заявку рассмотрит сотрудник" },
  DECISION: { actor: "Сотрудник банка", action: "Дождаться финального решения", next: "Банк сформирует предложение или сообщит решение" },
  OFFER: { actor: "Вы", action: "Принять или отклонить условия", next: "После принятия банк подготовит документы" },
  DOCUMENTS: { actor: "Банк", action: "Дождаться формирования документов", next: "Документы появятся для ознакомления и подписания" },
  SIGNING: { actor: "Вы", action: "Скачать документы, подтвердить ознакомление и выполнить demo-подписание", next: "Подписанный пакет будет передан банку" },
  READY_FOR_ISSUANCE: { actor: "Сотрудник банка", action: "Ничего — документы уже подписаны", next: "Банк отдельно подтвердит модельную выдачу" },
  ISSUED: { actor: "Завершено", action: "Дополнительных действий нет", next: "Документы и итоговые условия доступны в заявке" },
  MORE_INFO: { actor: "Вы", action: "Передать запрошенные сведения", next: "Банк повторно запустит проверку" },
  REJECTED: { actor: "Завершено банком", action: "Можно выполнить новый расчёт", next: "Новая заявка не изменит историю этой заявки" },
  DECLINED_BY_CLIENT: { actor: "Завершено вами", action: "Можно выполнить новый расчёт", next: "Подберите другое предложение" },
};

function branchStage(app: Application & { events?: AppEvent[] }) {
  const entry = [...(app.events ?? [])].reverse().find((event) => event.to_status === app.status);
  if (entry?.from_status && STATUS_STAGE[entry.from_status] !== undefined) return STATUS_STAGE[entry.from_status];
  if (app.status === "DECLINED_BY_CLIENT") return STATUS_STAGE.OFFER;
  if (app.status === "REJECTED") return STATUS_STAGE.DECISION;
  return STATUS_STAGE.DATA_CHECK;
}

export function StatusTimeline({ app }: { app: Application & { events?: AppEvent[] } }) {
  const branch = BRANCHES[app.status];
  const currentIdx = branch ? branchStage(app) : (STATUS_STAGE[app.status] ?? 0);
  const guidance = STATUS_GUIDANCE[app.status] ?? STATUS_GUIDANCE.SUBMITTED;
  const currentLabel = branch?.label ?? FLOW[currentIdx].label;

  return (
    <section aria-label="Этапы заявки" className="space-y-5">
      <ol className="grid grid-cols-1 md:grid-cols-9" aria-label="Основной путь заявки">
        {FLOW.map((stage, index) => {
          const current = !branch && index === currentIdx;
          const done = branch ? index <= currentIdx : index < currentIdx;
          const reached = done || current;
          return (
            <li key={stage.key} aria-current={current ? "step" : undefined} className="relative flex min-h-12 gap-3 pb-3 last:pb-0 md:block md:min-h-0 md:pb-0 md:text-center">
              {index < FLOW.length - 1 && (
                <span aria-hidden="true" className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5 md:left-1/2 md:top-3 md:h-0.5 md:w-full ${index < currentIdx ? "bg-[#EF3124]" : "bg-neutral-200"}`} />
              )}
              <span aria-hidden="true" className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold md:mx-auto ${done ? "border-[#EF3124] bg-[#EF3124] text-white" : current ? "border-[#EF3124] bg-white text-[#EF3124]" : "border-neutral-300 bg-white text-neutral-400"}`}>
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className={`relative z-10 bg-white pt-0.5 text-xs leading-tight md:mt-2 md:block md:px-1 md:pt-0 ${current ? "font-semibold text-[#EF3124]" : reached ? "text-neutral-700" : "text-neutral-400"}`}>
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      {branch && (
        <div aria-current="step" className={`rounded-xl border px-4 py-3 text-sm ${branch.className}`}>
          <p className="font-semibold">Ветка процесса: {branch.label}</p>
          <p className="mt-1">{branch.message}</p>
        </div>
      )}

      <div className="rounded-xl border bg-neutral-50 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">Текущий этап</p><p className="mt-1 font-semibold">{currentLabel}</p></div>
          <div><p className="text-xs text-muted-foreground">Кто действует</p><p className="mt-1 font-semibold">{guidance.actor}</p></div>
          <div><p className="text-xs text-muted-foreground">Ваше действие</p><p className="mt-1 text-sm">{guidance.action}</p></div>
          <div><p className="text-xs text-muted-foreground">Что дальше</p><p className="mt-1 text-sm">{guidance.next}</p></div>
        </div>
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">Версия статуса обновлена: {fmtDate(app.updated_at)}</p>
      </div>
    </section>
  );
}

export function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = { A: "bg-emerald-100 text-emerald-800", B: "bg-green-100 text-green-800", C: "bg-amber-100 text-amber-800", D: "bg-red-100 text-red-800" };
  return <Badge className={colors[grade] || "bg-gray-100"}>Класс {grade}</Badge>;
}

export function ScoreCard({ score, grade, factors, version }: { score: number; grade: string; factors: ScoreFactor[]; version?: string | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-3">
          Скоринговая оценка <TermHint term="scoring" />
          <span className="text-2xl font-black">{score}</span>
          <GradeBadge grade={grade} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Методология: {version || "legacy — версия не зафиксирована"}; максимум 105 баллов
        </p>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {factors.map((f) => (
            <div key={f.key} className="py-2 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{f.label}: <span className="font-normal text-muted-foreground">{f.value}</span></p>
                <p className="text-xs text-muted-foreground">{f.explanation}</p>
              </div>
              <span className={`text-sm font-bold whitespace-nowrap ${f.points >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {f.points >= 0 ? "+" : ""}{f.points}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export { paymentTypeLabel, resolveCreditTerms } from "@/lib/credit-terms";

function percent(value: number | null) {
  return value === null ? "Не указано" : `${value.toLocaleString("ru-RU")}%`;
}

function months(value: number | null) {
  return value === null ? "Не указано" : `${value.toLocaleString("ru-RU")} мес.`;
}

function comparisonRows(app: Application, offer: ResolvedCreditTerms) {
  const preliminary = resolveCreditTerms(app.preliminaryTerms);
  return [
    ["Продукт", app.preliminaryTerms?.productName ?? app.product_name ?? "Не указан", app.decision?.productName ?? app.product_name ?? "Не указан"],
    ["Сумма", fmtMoney(preliminary.amount), fmtMoney(offer.amount)],
    ["Ставка", percent(preliminary.rate), percent(offer.rate)],
    ["Срок", months(preliminary.termMonths), months(offer.termMonths)],
    ["Платёж в месяц", fmtMoney(preliminary.monthlyPayment), fmtMoney(offer.monthlyPayment)],
    ["Переплата", fmtMoney(preliminary.overpayment), fmtMoney(offer.overpayment)],
    ["Всего к возврату", fmtMoney(preliminary.totalPayment), fmtMoney(offer.totalPayment)],
  ];
}

// Карточка предложения банка с действиями клиента
export function OfferCard({ app, onAction, busy }: { app: Application; onAction: (a: "accept" | "decline") => void; busy: boolean }) {
  if (app.status !== "OFFER") return null;
  const decision = app.decision;
  const offer = resolveCreditTerms(decision);
  const conditional = decision?.type === "CONDITIONS";
  const snapshotError = creditTermsSnapshotError(decision);
  const alternativeProduct = decision?.productId != null && decision.productId !== app.product_id;

  return (
    <Card className="border-green-300 bg-green-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-green-800">{conditional ? "Банк предлагает альтернативные условия" : "Финальное предложение банка"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border bg-white px-3 py-3 text-sm">
          {alternativeProduct ? <Shuffle className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /> : <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />}
          <div><span className="text-muted-foreground">Продукт банка: </span><b>{decision?.productName || app.product_name || "Не указан"}</b>{alternativeProduct && <p className="mt-1 text-xs text-blue-800">Банк предложил другой продукт — сравните условия ниже.</p>}</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Основной долг</p><p className="mt-1 text-lg font-bold">{fmtMoney(offer.amount)}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Ставка</p><p className="mt-1 text-lg font-bold">{percent(offer.rate)}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Срок</p><p className="mt-1 text-lg font-bold">{months(offer.termMonths)}</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Платёж в месяц</p><p className="mt-1 font-bold">{fmtMoney(offer.monthlyPayment)}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Переплата</p><p className="mt-1 font-bold">{fmtMoney(offer.overpayment)}</p></div>
          <div className="rounded-lg border bg-white p-3"><p className="text-xs text-muted-foreground">Общая выплата</p><p className="mt-1 font-bold">{fmtMoney(offer.totalPayment)}</p></div>
        </div>
        <div className="grid gap-2 rounded-lg border bg-white px-3 py-3 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Тип платежа: </span><b>{paymentTypeLabel(decision?.paymentType)}</b></p>
          <p className="sm:text-right"><span className="text-muted-foreground">Предложение действительно: </span><b>{validUntilLabel(decision?.validUntil)}</b></p>
        </div>

        {app.preliminaryTerms ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Предварительный расчёт и предложение банка</p>
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead className="bg-neutral-50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Параметр</th><th className="px-3 py-2 font-medium">Предварительно</th><th className="px-3 py-2 font-medium">Предложение банка</th></tr></thead>
                <tbody className="divide-y">{comparisonRows(app, offer).map(([label, before, after]) => <tr key={label}><th className="px-3 py-2 font-medium">{label}</th><td className="px-3 py-2">{before}</td><td className="px-3 py-2 font-semibold">{after}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-white px-3 py-2 text-xs text-muted-foreground">В этой ранее созданной заявке предварительные условия не сохранены. Ориентируйтесь на финальные условия банка выше.</p>
        )}

        {decision?.reason && <p className="text-sm text-muted-foreground">{decision.reason}</p>}
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{ECONOMICS_DISCLOSURE}</p>
        {snapshotError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Ошибка данных предложения: {snapshotError} Принятие недоступно — запросите у банка обновлённое решение.</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={() => onAction("accept")} disabled={busy || Boolean(snapshotError)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Принять условия
          </Button>
          <Button variant="outline" className="flex-1 whitespace-normal" onClick={() => onAction("decline")} disabled={busy}>
            <X className="h-4 w-4" /> Отклонить и подобрать другое
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Детерминированный помощник: ответы формируются только локальными шаблонами.
export function TemplateAssistant({ applicationId, initial = [] }: { applicationId?: number; initial?: { role: string; content: string; source?: string }[] }) {
  const [messages, setMessages] = useState(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput(""); setBusy(true);
    setMessages((m) => [...m, { role: "user", content: q }]);
    try {
      const r = await api.askAssistant(q, applicationId);
      setMessages((m) => [...m, { role: "assistant", content: r.text, source: r.source }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Ошибка: " + (e as Error).message, source: "template" }]);
    } finally { setBusy(false); }
  };

  return (
    <Card className="flex flex-col h-[420px]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="w-5 h-5 text-[#EF3124]" /> Шаблонный помощник
          <span className="text-[10px] font-normal text-muted-foreground">Демо-ответы по фиксированным правилам, без ИИ</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-2 text-sm" role="log" aria-live="polite" aria-label="Сообщения шаблонного помощника">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-xs">Спросите о продуктах, документах, ставках или статусе заявки. Например: «какие документы нужны?»</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 ${m.role === "user" ? "bg-[#EF3124] text-white ml-auto" : "bg-neutral-100"}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="text-xs text-muted-foreground" role="status">Помощник готовит ответ…</div>}
        <div ref={bottomRef} />
      </CardContent>
      <div className="p-3 pt-0 flex gap-2">
        <Label htmlFor="assistant-question" className="sr-only">Вопрос ассистенту</Label>
        <Textarea id="assistant-question" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ваш вопрос…"
          className="min-h-[38px] max-h-[80px]" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button type="button" onClick={send} disabled={busy || !input.trim()} aria-label="Отправить вопрос"><Send className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

export function EventLog({ events }: { events: AppEvent[] }) {
  return (
    <div className="space-y-0">
      {events.map((e) => (
        <div key={e.id} className="flex gap-3 pb-4 relative">
          <div className="flex flex-col items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#EF3124] mt-1.5" />
            <div className="w-px flex-1 bg-neutral-200" />
          </div>
          <div className="pb-1">
            <p className="text-sm font-medium">{e.comment || e.to_status}</p>
            <p className="text-xs text-muted-foreground">{e.actor} · {fmtDate(e.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
