import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Clock3, Loader2, RefreshCw, Search, X } from "lucide-react";
import { api, fmtDate, fmtMoney, type Application } from "@/lib/api";
import { useAuth } from "@/auth";
import { GradeBadge, StatusBadge } from "@/components/widgets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL_STATUSES = "ALL";
const STATUSES = [ALL_STATUSES, "DECISION", "MORE_INFO", "OFFER", "READY_FOR_ISSUANCE", "ISSUED", "REJECTED", "SUBMITTED", "SCORING"];
const ACTION_STATUSES = new Set(["DECISION", "READY_FOR_ISSUANCE"]);
const HOUR_MS = 60 * 60 * 1000;

type QueueApplication = Application & { company_name?: string; company_inn?: string; okved_name?: string; client_name?: string };
type SortOrder = "newest" | "oldest";

function requiresBankAction(application: QueueApplication) {
  return ACTION_STATUSES.has(application.status)
    || (application.status === "MORE_INFO" && application.active_more_info_request?.type === "SYSTEM_RETRY");
}

function applicationAge(createdAt: string) {
  const createdTime = new Date(createdAt).getTime();
  if (Number.isNaN(createdTime)) {
    return { ageLabel: "неизвестен", slaLabel: "SLA: нет данных", className: "border-neutral-200 bg-neutral-50 text-neutral-600" };
  }

  const ageHours = Math.max(0, Math.floor((Date.now() - createdTime) / HOUR_MS));
  const ageLabel = ageHours < 1 ? "< 1 ч" : ageHours < 24 ? `${ageHours} ч` : `${Math.floor(ageHours / 24)} дн.`;
  if (ageHours >= 48) return { ageLabel, slaLabel: "SLA нарушен", className: "border-red-200 bg-red-50 text-red-700" };
  if (ageHours >= 24) return { ageLabel, slaLabel: "Риск SLA", className: "border-amber-200 bg-amber-50 text-amber-700" };
  return { ageLabel, slaLabel: "В SLA", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
}

function dateValue(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export default function Queue() {
  const { user, logout } = useAuth();
  const [rows, setRows] = useState<QueueApplication[]>([]);
  const [status, setStatus] = useState(ALL_STATUSES);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [actionOnly, setActionOnly] = useState(false);
  const [loadStatus, setLoadStatus] = useState<"loading" | "error" | "success">("loading");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    await Promise.resolve();
    setLoadStatus("loading");
    setLoadError("");
    try {
      setRows(await api.queue());
      setLoadStatus("success");
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить очередь");
      setLoadStatus("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    api.queue()
      .then((data) => { if (active) { setRows(data); setLoadStatus("success"); } })
      .catch((reason: unknown) => { if (active) { setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить очередь"); setLoadStatus("error"); } });
    return () => { active = false; };
  }, []);

  const statusCounts = useMemo(() => rows.reduce<Record<string, number>>((counts, application) => {
    counts[application.status] = (counts[application.status] || 0) + 1;
    return counts;
  }, {}), [rows]);
  const actionCount = useMemo(() => rows.filter(requiresBankAction).length, [rows]);
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
    return rows
      .filter((application) => status === ALL_STATUSES || application.status === status)
      .filter((application) => !actionOnly || requiresBankAction(application))
      .filter((application) => !normalizedQuery || [application.public_no, application.company_inn, application.company_name]
        .some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(normalizedQuery)))
      .sort((left, right) => {
        const difference = dateValue(right.created_at) - dateValue(left.created_at);
        return sortOrder === "newest" ? difference : -difference;
      });
  }, [actionOnly, query, rows, sortOrder, status]);

  const counters = [
    { status: ALL_STATUSES, label: "Всего", count: rows.length },
    { status: "DECISION", label: "На решении", count: statusCounts.DECISION || 0 },
    { status: "MORE_INFO", label: "Уточнения и проверки", count: statusCounts.MORE_INFO || 0 },
    { status: "READY_FOR_ISSUANCE", label: "К выдаче", count: statusCounts.READY_FOR_ISSUANCE || 0 },
  ];
  const hasActiveFilters = status !== ALL_STATUSES || actionOnly || query.trim().length > 0;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b bg-[#1a1a1a] text-white">
        <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EF3124] font-black">A</div>
            <div className="min-w-0 leading-tight">
              <span className="block truncate font-bold sm:hidden">Бэк-офис</span>
              <span className="hidden font-bold sm:block">Кредитный конвейер — бэкофис</span>
            </div>
            <Badge className="hidden border-white/20 bg-white/10 text-white md:inline-flex">аналитик</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-3">
            <span className="hidden text-neutral-400 lg:inline">{user?.name}</span>
            <Button variant="ghost" size="sm" className="px-2 text-white hover:bg-white/10 sm:px-3" onClick={logout}>Выйти</Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-5 sm:py-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Рабочее место аналитика</p>
            <h1 className="text-xl font-bold sm:text-2xl">Очередь заявок</h1>
          </div>
          {loadStatus === "success" && <span className="text-sm text-muted-foreground">{rows.length} всего</span>}
        </div>

        {loadStatus === "success" && (
          <>
            <section aria-label="Счётчики очереди" className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {counters.map((counter) => (
                <button
                  key={counter.status}
                  type="button"
                  aria-pressed={!actionOnly && status === counter.status}
                  onClick={() => { setStatus(counter.status); setActionOnly(false); }}
                  className={`rounded-xl border bg-white p-3 text-left transition-colors hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!actionOnly && status === counter.status ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"}`}
                >
                  <span className="block text-xs text-muted-foreground">{counter.label}</span>
                  <strong className="mt-1 block text-2xl leading-none tabular-nums">{counter.count}</strong>
                </button>
              ))}
            </section>

            <section aria-label="Управление очередью" className="mb-4 grid gap-3 rounded-xl border bg-white p-3 lg:grid-cols-[minmax(16rem,1fr)_13rem_12rem_auto] lg:items-end">
              <div className="space-y-1">
                <Label htmlFor="queue-search" className="text-xs text-muted-foreground">Поиск</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="queue-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Номер, ИНН или компания"
                    aria-label="Поиск по публичному номеру, ИНН или компании"
                    className="pl-9 pr-9"
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-neutral-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="queue-status" className="text-xs text-muted-foreground">Статус</Label>
                <Select value={status} onValueChange={(value) => { setStatus(value); setActionOnly(false); }}>
                  <SelectTrigger id="queue-status" aria-label="Фильтр очереди по статусу"><SelectValue placeholder="Все статусы" /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s === ALL_STATUSES ? "Все статусы" : (STATUS_RU[s] || s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="queue-sort" className="text-xs text-muted-foreground">Сортировка</Label>
                <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as SortOrder)}>
                  <SelectTrigger id="queue-sort" aria-label="Сортировка очереди"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Сначала свежие</SelectItem>
                    <SelectItem value="oldest">Сначала старые</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant={actionOnly ? "default" : "outline"}
                aria-pressed={actionOnly}
                className={actionOnly ? "bg-[#1a1a1a] hover:bg-neutral-800" : ""}
                onClick={() => { setActionOnly((current) => !current); setStatus(ALL_STATUSES); }}
              >
                <AlertCircle className="h-4 w-4" /> Требует действия <span className="tabular-nums">{actionCount}</span>
              </Button>
            </section>

            <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>Показано {visibleRows.length} из {rows.length}</span>
              <span className="hidden sm:inline">SLA: до 24 ч · риск 24–48 ч · нарушение после 48 ч</span>
            </div>
          </>
        )}

        <div className="sr-only" role="status" aria-live="polite">{loadStatus === "loading" ? "Загрузка очереди" : loadStatus === "error" ? "Ошибка загрузки очереди" : `Показано заявок: ${visibleRows.length} из ${rows.length}`}</div>
        {loadStatus === "loading" ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка очереди…</div>
        ) : loadStatus === "error" ? (
          <Card className="border-red-200 bg-red-50" role="alert">
            <CardContent className="p-5">
              <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><p className="font-semibold text-red-950">Не удалось загрузить очередь</p><p className="mt-1 text-sm text-red-800">{loadError}</p></div></div>
              <Button type="button" variant="outline" size="sm" className="mt-4 border-red-200 bg-white" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Повторить</Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center"><p className="font-medium">Заявок нет</p><p className="mt-1 text-sm text-muted-foreground">Очередь пока пуста.</p></div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="font-medium">Ничего не найдено</p>
            <p className="mt-1 text-sm text-muted-foreground">Измените запрос или сбросьте фильтры.</p>
            {hasActiveFilters && <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => { setQuery(""); setStatus(ALL_STATUSES); setActionOnly(false); }}>Сбросить фильтры</Button>}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRows.map((a) => {
              const age = applicationAge(a.created_at);
              return (
                <Link key={a.id} to={`/bank/applications/${a.id}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <Card className="cursor-pointer transition-shadow hover:shadow-md">
                    <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-6">
                      <div className="flex items-center justify-between gap-3 lg:w-28 lg:block">
                        <span className="font-mono text-xs text-muted-foreground">{a.public_no}</span>
                        <span className="text-xs text-muted-foreground lg:mt-1 lg:block">{fmtDate(a.created_at)}</span>
                      </div>
                      <div className="min-w-0 flex-1 lg:max-w-xs">
                        <p className="truncate text-sm font-semibold">{a.company_name || "Компания не указана"}</p>
                        <p className="truncate text-xs text-muted-foreground">ИНН {a.company_inn || "—"}{a.okved_name ? ` · ${a.okved_name}` : ""}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{a.product_name || "Продукт не указан"}</p>
                        <p className="text-xs text-muted-foreground">{fmtMoney(a.amount)} · {a.term_months} мес.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:max-w-md lg:justify-end">
                        {a.grade ? <GradeBadge grade={a.grade} /> : <Badge variant="outline">скоринг…</Badge>}
                        <StatusBadge status={a.status} label={a.status_label} />
                        {a.status === "MORE_INFO" && a.active_more_info_request && (
                          <Badge variant="outline" className={a.active_more_info_request.type === "SYSTEM_RETRY" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-orange-200 bg-orange-50 text-orange-900"}>
                            {a.active_more_info_request.type === "SYSTEM_RETRY" ? "Действие банка: повторить проверку" : "Ожидается ответ клиента"}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={age.className}
                          title={`Возраст с момента подачи: ${age.ageLabel}. ${age.slaLabel}`}
                          aria-label={`Возраст заявки ${age.ageLabel}. ${age.slaLabel}`}
                        >
                          <Clock3 className="mr-1 h-3 w-3" /> {age.ageLabel} · {age.slaLabel}
                        </Badge>
                        <span className="hidden text-xs text-muted-foreground xl:inline">обновлена {fmtDate(a.updated_at)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

const STATUS_RU: Record<string, string> = {
  SUBMITTED: "Принята", DATA_CHECK: "Проверка данных", ENRICHMENT: "Обогащение данных", SCORING: "Скоринг",
  DECISION: "Кредитное решение", MORE_INFO: "Запрошено уточнение", OFFER: "Предложение клиенту",
  READY_FOR_ISSUANCE: "Ожидает подтверждения выдачи", ISSUED: "Выдано", REJECTED: "Отказ",
};
