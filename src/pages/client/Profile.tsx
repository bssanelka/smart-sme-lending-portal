import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Building2,
  CircleAlert,
  ClipboardList,
  Landmark,
  RotateCcw,
  Send,
  ShieldCheck,
  TrendingUp,
  UserRound,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TermHint, { type TermKey } from "@/components/TermHint";
import {
  api,
  fmtMoney,
  type BenefitPreviewItem,
  type BenefitPreviewPurpose,
  type BenefitPreviewResponse,
  type BenefitPreviewSmeStatus,
  type ClientProfile,
} from "@/lib/api";

type SmeStatus = BenefitPreviewSmeStatus;
type SupportPurpose = "" | BenefitPreviewPurpose;

type SupportAnswers = {
  region: string;
  smeStatus: SmeStatus;
  purpose: SupportPurpose;
  amount: string;
  term: string;
  industry: string;
};

const segmentLabels: Record<string, string> = {
  micro: "Микробизнес",
  small: "Малый бизнес",
  medium: "Средний бизнес",
};

const financialSourceLabels: Record<ClientProfile["financials"][number]["source"], string> = {
  CLIENT: "отчётность клиента",
  BANK: "данные банка",
  DEMO_SEED: "демо-отчётность",
  LEGACY: "перенесённая отчётность",
};

const purposeLabels: Record<Exclude<SupportPurpose, "">, string> = {
  working_capital: "Оборотные средства",
  investment: "Оборудование или развитие",
  guarantee: "Гарантия или поручительство",
  digitalization: "Цифровизация",
  consulting: "Консультации или обучение",
  other: "Другая цель",
};

const emptyAnswers: SupportAnswers = {
  region: "",
  smeStatus: "unknown",
  purpose: "",
  amount: "",
  term: "",
  industry: "",
};

function percent(value: number | null): string {
  return value === null ? "Нет данных" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function date(value: string): string {
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function inferRegion(address: string): string {
  const firstAddressPart = address.split(",")[0]?.trim();
  return firstAddressPart || address;
}

function getInitialAnswers(profile: ClientProfile): SupportAnswers {
  const profileSegment = profile.company.segment;
  const smeStatus: SmeStatus = profileSegment === "micro" || profileSegment === "small" || profileSegment === "medium"
    ? profileSegment
    : "unknown";

  return {
    region: inferRegion(profile.company.address),
    smeStatus,
    purpose: "",
    amount: "",
    term: "",
    industry: `${profile.company.okved_code} · ${profile.company.okved_name}`,
  };
}

function MetricCard({ icon, label, term, value, hint, metadata }: {
  icon: ReactNode;
  label: string;
  term?: TermKey;
  value: string;
  hint: string;
  metadata?: { source: string; freshness: string; status: string };
}) {
  return (
    <Card className="gap-3 py-5">
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}<span>{label}{term && <TermHint term={term} />}</span></div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {metadata && (
          <div className="space-y-1 border-t pt-2 text-xs leading-relaxed text-muted-foreground">
            <p><span className="font-medium text-foreground/80">Источник:</span> {metadata.source}</p>
            <p><span className="font-medium text-foreground/80">Актуальность:</span> {metadata.freshness}</p>
            <p><span className="font-medium text-foreground/80">Статус:</span> {metadata.status}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BenefitCard({ result, questionnaireApplied }: { result: BenefitPreviewItem; questionnaireApplied: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = `benefit-details-${result.item.id}`;
  const item = result.item;

  return (
    <Card className="gap-4 border-amber-200 py-5">
      <CardHeader className="gap-3 px-5 pb-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Badge variant="outline">{item.category}</Badge>
          <Badge className="border-amber-200 bg-amber-50 text-amber-900">Проверка не проводилась</Badge>
        </div>
        <div>
          <CardTitle className="text-lg leading-snug">{item.title}</CardTitle>
          <CardDescription className="mt-2 text-sm leading-relaxed">
            <span className="font-medium text-foreground">Возможная польза: </span>{item.benefit}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5">
        <dl className="grid gap-3 rounded-lg bg-neutral-100 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">Регион</dt>
            <dd className="mt-1">{item.applicability.region}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">Кому и для чего</dt>
            <dd className="mt-1">{item.applicability.scope}</dd>
          </div>
        </dl>

        {questionnaireApplied && (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="font-semibold text-emerald-950">Почему показано</p>
              <ul className="mt-2 space-y-1.5 text-emerald-950/80">
                {result.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-semibold text-amber-950">Что пока неизвестно</p>
              <ul className="mt-2 space-y-1.5 text-amber-950/80">
                {result.unknowns.map((unknown) => <li key={unknown}>• {unknown}</li>)}
              </ul>
            </div>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((current) => !current)}
        >
          {detailsOpen ? "Скрыть подробности" : "Условия, документы и источник"}
        </Button>

        {detailsOpen && (
          <div id={detailsId} className="space-y-4 rounded-xl border bg-white p-4 text-sm">
            <div>
              <p className="font-semibold">Условия, которые нужно уточнить</p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                {item.unknownCriteria.map((criterion) => <li key={criterion}>• {criterion}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-semibold">Что может потребоваться</p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                {item.requiredEvidence.map((evidence) => <li key={evidence}>• {evidence}</li>)}
              </ul>
            </div>
            <div className="rounded-lg bg-neutral-100 p-3">
              <p className="font-semibold">Источник записи</p>
              <p className="mt-1 text-muted-foreground">{item.source.entry} · данные обновлены {date(item.source.updatedAt)}</p>
            </div>
            <div>
              <p className="font-semibold">Возможный следующий шаг</p>
              <p className="mt-1 text-muted-foreground">{item.nextStep}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Profile() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<SupportAnswers>(emptyAnswers);
  const [preview, setPreview] = useState<BenefitPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewRequest = useRef(0);

  const updateAnswers = (patch: Partial<SupportAnswers>) => {
    previewRequest.current += 1;
    setAnswers((current) => ({ ...current, ...patch }));
    setPreview(null);
    setPreviewError("");
    setPreviewBusy(false);
  };

  const loadProfile = (data: ClientProfile) => {
    previewRequest.current += 1;
    setProfile(data);
    setAnswers(getInitialAnswers(data));
    setPreview(null);
    setPreviewError("");
    setPreviewBusy(false);
  };

  const retry = () => {
    setError("");
    api.clientProfile().then(loadProfile).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить профиль");
    });
  };

  useEffect(() => {
    let active = true;
    api.clientProfile()
      .then((data) => { if (active) loadProfile(data); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить профиль");
      });
    return () => { active = false; };
  }, []);

  if (!profile && !error) {
    return <div className="min-h-screen bg-neutral-50 flex items-center justify-center text-muted-foreground">Загрузка профиля…</div>;
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-neutral-50 p-4 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Профиль не загрузился</CardTitle><CardDescription>{error}</CardDescription></CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={retry}>Повторить</Button>
            <Button asChild variant="outline"><Link to="/dashboard">Вернуться в кабинет</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const latestFinancials = profile.financials[0] ?? null;
  const bki = profile.credit_history;
  const debtLoadSources = [
    latestFinancials ? financialSourceLabels[latestFinancials.source] : null,
    bki ? "кредитная история в профиле" : null,
  ].filter((source): source is string => Boolean(source));
  const debtLoadFreshness = [
    latestFinancials ? `отчётность за ${latestFinancials.year} г., запись от ${date(latestFinancials.verified_at ?? latestFinancials.submitted_at)}` : null,
    bki?.updated_at ? `БКИ на ${date(bki.updated_at)}` : null,
  ].filter((value): value is string => Boolean(value));
  const debtLoadStatus = profile.indicators.pdn_percent === null
    ? "Расчёт недоступен по текущим данным"
    : latestFinancials?.status === "VERIFIED"
      ? "Отчётность отмечена как проверенная; сам расчёт не подтверждён"
      : "Расчёт по непроверенной отчётности; требует уточнения";
  const benefits = profile.benefits;
  const displayedBenefits: BenefitPreviewItem[] = preview
    ? preview.items
    : benefits.map((item) => ({ item, reasons: [], unknowns: [] }));
  const questionnaireComplete = Boolean(
    answers.region.trim()
    && answers.smeStatus
    && answers.purpose,
  );

  const submitQuestionnaire = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!questionnaireComplete || !answers.purpose) return;

    const requestId = ++previewRequest.current;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const result = await api.previewClientBenefits({
        region: answers.region.trim(),
        sme_status: answers.smeStatus,
        purpose: answers.purpose,
        ...(answers.amount ? { amount: Number(answers.amount) } : {}),
        ...(answers.term ? { term_months: Number(answers.term) } : {}),
        ...(answers.industry.trim() ? { industry: answers.industry.trim() } : {}),
      });
      if (previewRequest.current === requestId) setPreview(result);
    } catch (reason) {
      if (previewRequest.current === requestId) {
        setPreviewError(reason instanceof Error ? reason.message : "Не удалось выполнить предварительный расчёт");
      }
    } finally {
      if (previewRequest.current === requestId) setPreviewBusy(false);
    }
  };

  const clearPreview = () => {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewError("");
    setPreviewBusy(false);
  };

  const resetQuestionnaire = () => {
    setAnswers(getInitialAnswers(profile));
    clearPreview();
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4" /> Кабинет</Link>
          </Button>
          <span className="font-bold">Профиль и льготы</span>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <Card className="border-0 bg-gradient-to-br from-[#EF3124] to-[#B82319] text-white shadow-lg">
          <CardContent className="grid gap-6 py-2 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
                <UserRound className="h-6 w-6" />
              </div>
              <p className="text-sm text-white/75">Личный профиль предпринимателя</p>
              <h1 className="mt-1 text-2xl font-bold md:text-3xl">{profile.user.name}</h1>
              <p className="mt-2 text-sm text-white/85">{profile.user.position}</p>
            </div>
            <div className="flex flex-wrap gap-2 md:max-w-xs md:justify-end">
              <Badge className="border-white/25 bg-white/15 text-white">{profile.company.form}</Badge>
              <Badge className="border-white/25 bg-white/15 text-white">{segmentLabels[profile.company.segment] ?? profile.company.segment}</Badge>
              <Badge className="border-white/25 bg-white/15 text-white">ОКВЭД {profile.company.okved_code}</Badge>
            </div>
          </CardContent>
        </Card>

        <section aria-labelledby="profile-metrics-title">
          <div className="mb-3">
            <h2 id="profile-metrics-title" className="text-xl font-bold">Ключевые показатели</h2>
            <p className="text-sm text-muted-foreground">Краткий обзор данных профиля без оценки вероятности одобрения</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Кредитная история"
              term="bki"
              value={bki ? String(bki.bki_score) : "Нет данных"}
              hint="Балл из данных профиля. Сам по себе он не определяет решение."
              metadata={{
                source: "Кредитная история в профиле",
                freshness: bki?.updated_at ? date(bki.updated_at) : "Дата не указана",
                status: bki ? "Статус проверки источника не передан" : "Запись отсутствует",
              }}
            />
            <MetricCard
              icon={<WalletCards className="h-4 w-4" />}
              label="Долговая нагрузка"
              term="pdn"
              value={percent(profile.indicators.pdn_percent)}
              hint="Доля среднемесячной выручки, которая уходит на обязательства."
              metadata={{
                source: debtLoadSources.join(" + ") || "Данные отсутствуют",
                freshness: debtLoadFreshness.join("; ") || "Дата не определена",
                status: debtLoadStatus,
              }}
            />
            <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Изменение выручки" value={percent(profile.indicators.revenue_growth_percent)} hint="Сравнение с предыдущим доступным годом." />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-[#EF3124]" /> Компания</CardTitle>
              <CardDescription>Сведения из профиля компании</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div><p className="text-muted-foreground">Наименование</p><p className="mt-1 font-medium">{profile.company.name}</p></div>
              <div><p className="text-muted-foreground">Руководитель</p><p className="mt-1 font-medium">{profile.company.head_name}</p></div>
              <div><p className="text-muted-foreground">ИНН</p><p className="mt-1 font-medium">{profile.company.inn}</p></div>
              <div><p className="text-muted-foreground">ОГРН / ОГРНИП</p><p className="mt-1 font-medium">{profile.company.ogrn}</p></div>
              <div><p className="text-muted-foreground">Дата регистрации</p><p className="mt-1 font-medium">{date(profile.company.reg_date)}</p></div>
              <div><p className="text-muted-foreground">Возраст бизнеса</p><p className="mt-1 font-medium">{profile.indicators.business_age_years.toLocaleString("ru-RU")} года</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">Основной вид деятельности</p><p className="mt-1 font-medium">{profile.company.okved_code} · {profile.company.okved_name}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground">Адрес</p><p className="mt-1 font-medium">{profile.company.address}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-[#EF3124]" /> Финансовый профиль</CardTitle>
              <CardDescription>Последние доступные данные компании и кредитной истории. Статус показывает, проверил ли банк отчётность.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {latestFinancials && <div className="sm:col-span-2"><Badge className={latestFinancials.status === "VERIFIED" ? "bg-emerald-700" : "bg-amber-100 text-amber-900"}>{latestFinancials.status === "VERIFIED" ? "Отчётность подтверждена банком" : "Данные предоставлены, проверка банка ожидается"}</Badge></div>}
              <div><p className="text-muted-foreground">Выручка {latestFinancials?.year ?? ""}</p><p className="mt-1 font-medium">{latestFinancials ? fmtMoney(latestFinancials.revenue) : "Нет данных"}</p></div>
              <div><p className="text-muted-foreground">Прибыль</p><p className="mt-1 font-medium">{latestFinancials ? fmtMoney(latestFinancials.profit) : "Нет данных"}</p></div>
              <div><p className="text-muted-foreground">Собственный капитал</p><p className="mt-1 font-medium">{latestFinancials ? fmtMoney(latestFinancials.own_capital) : "Нет данных"}</p></div>
              <div><p className="text-muted-foreground">Общий долг</p><p className="mt-1 font-medium">{bki ? fmtMoney(bki.total_debt) : "Нет данных"}</p></div>
              <div><p className="text-muted-foreground">Активные кредиты</p><p className="mt-1 font-medium">{bki?.active_credits ?? "Нет данных"}</p></div>
              <div><p className="text-muted-foreground">Просрочки</p><p className="mt-1 font-medium">{bki ? (bki.overdue_count > 0 ? `${bki.overdue_count}, максимум ${bki.worst_delay_days} дн.` : "Нет") : "Нет данных"}</p></div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-blue-700" /> Как устроена выдача кредита</CardTitle>
            <CardDescription>Три шага делает клиент, три шага выполняет банк. Автоматизация помогает с проверками, но не подменяет финальное решение сотрудника.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl bg-neutral-50 p-4">
                <p className="mb-3 flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-[#EF3124]" /> Ваши 3 шага</p>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EF3124] text-xs font-bold text-white">1</span><span><b>Определить потребность:</b> цель, точная сумма и желаемый срок.</span></li>
                  <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EF3124] text-xs font-bold text-white">2</span><span><b>Проверить и отправить:</b> система подберёт продукт и зафиксирует параметры заявки.</span></li>
                  <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EF3124] text-xs font-bold text-white">3</span><span><b>Рассмотреть предложение:</b> принять условия или вернуться к новому подбору.</span></li>
                </ol>
              </div>
              <div className="rounded-xl bg-blue-50 p-4">
                <p className="mb-3 flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-blue-700" /> 3 шага банка</p>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">1</span><span><b>Проверить данные:</b> полноту, реестр компании и кредитную историю.</span></li>
                  <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">2</span><span><b>Оценить риск:</b> система готовит скоринг и предварительную рекомендацию.</span></li>
                  <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">3</span><span><b>Принять решение:</b> сотрудник подтверждает, меняет условия или предлагает другой продукт.</span></li>
                </ol>
              </div>
            </div>

            <Button asChild><Link to="/dashboard?tab=calculator"><Send /> Определить потребность и начать</Link></Button>
          </CardContent>
        </Card>

        <section aria-labelledby="support-directions-title" className="space-y-4">
          <div>
            <h2 id="support-directions-title" className="text-xl font-bold">Возможные направления поддержки</h2>
            <p className="text-sm text-muted-foreground">Список уже отобран сервером по данным профиля. Опрос только упорядочивает его и может скрыть явно неподходящие варианты.</p>
          </div>

          <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note" aria-label="Ограничения демонстрационной подборки">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <p><b>Это синтетическая демо-подборка, а не официальный каталог.</b> Актуальность мер и право компании на участие не проверены; перед обращением условия нужно сверить с официальным источником.</p>
          </div>

          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-lg">Упорядочить направления</CardTitle>
              <CardDescription>Регион, статус и отрасль подставлены из профиля — проверьте их. При расчёте ответы отправляются серверу один раз, используются только для упорядочивания этой подборки и не сохраняются. Опрос не ищет новые программы и не подтверждает право на участие.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={submitQuestionnaire} aria-busy={previewBusy}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="support-region">Регион</Label>
                    <Input id="support-region" value={answers.region} onChange={(event) => updateAnswers({ region: event.target.value })} placeholder="Например, Москва" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="support-sme-status">Статус МСП</Label>
                    <Select value={answers.smeStatus} onValueChange={(value: SmeStatus) => updateAnswers({ smeStatus: value })}>
                      <SelectTrigger id="support-sme-status" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="micro">Микропредприятие</SelectItem>
                        <SelectItem value="small">Малое предприятие</SelectItem>
                        <SelectItem value="medium">Среднее предприятие</SelectItem>
                        <SelectItem value="not_sme">Не относится к МСП</SelectItem>
                        <SelectItem value="unknown">Не знаю</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                    <Label htmlFor="support-purpose">Цель</Label>
                    <Select value={answers.purpose} onValueChange={(value: Exclude<SupportPurpose, "">) => updateAnswers({ purpose: value })}>
                      <SelectTrigger id="support-purpose" className="w-full"><SelectValue placeholder="Выберите цель" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(purposeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="support-amount">Ориентировочная сумма, ₽ <span className="font-normal text-muted-foreground">(необязательно)</span></Label>
                    <Input id="support-amount" type="number" inputMode="numeric" min="1" step="1" value={answers.amount} onChange={(event) => updateAnswers({ amount: event.target.value })} placeholder="1 000 000" />
                    <p className="text-xs text-muted-foreground">Покажем как условие для проверки; структурированных лимитов в демо-каталоге нет.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="support-term">Ориентировочный срок, мес. <span className="font-normal text-muted-foreground">(необязательно)</span></Label>
                    <Input id="support-term" type="number" inputMode="numeric" min="1" step="1" value={answers.term} onChange={(event) => updateAnswers({ term: event.target.value })} placeholder="24" />
                    <p className="text-xs text-muted-foreground">Не влияет на сортировку, пока у направлений нет проверенных диапазонов.</p>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                    <Label htmlFor="support-industry">Отрасль <span className="font-normal text-muted-foreground">(справочно)</span></Label>
                    <Input id="support-industry" value={answers.industry} onChange={(event) => updateAnswers({ industry: event.target.value })} placeholder="Вид деятельности" />
                    <p className="text-xs text-muted-foreground">Сервер сверяет этот ответ только с каноническим ОКВЭД профиля; свободный текст не подтверждает отраслевое соответствие.</p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="submit" disabled={!questionnaireComplete || previewBusy}>
                    {previewBusy ? "Расчёт на сервере…" : preview ? "Обновить порядок" : "Упорядочить направления"}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetQuestionnaire}><RotateCcw /> Сбросить опрос</Button>
                </div>
                {previewError && <p className="text-sm text-destructive" role="alert">{previewError}</p>}
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-end justify-between gap-2" aria-live="polite">
            <div>
              <h3 className="font-semibold">{preview ? "Упорядоченные направления" : "Направления, отобранные по профилю"}</h3>
              <p className="text-sm text-muted-foreground">
                {preview
                  ? `Показано ${displayedBenefits.length} из ${benefits.length}. Сервер выполнил одноразовое упорядочивание без проверки права, внешних данных и сохранения ответов.`
                  : `Показано ${benefits.length}. Заполните опрос, чтобы сервер изменил порядок и скрыл явно несовместимые варианты.`}
              </p>
            </div>
            {preview && <Button type="button" variant="ghost" size="sm" onClick={clearPreview}>Изменить ответы без фильтра</Button>}
          </div>

          {displayedBenefits.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {displayedBenefits.map((result) => <BenefitCard key={result.item.id} result={result} questionnaireApplied={Boolean(preview)} />)}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="font-semibold">Среди доступных направлений совпадений не найдено</p>
                <p className="mt-1 text-sm text-muted-foreground">Измените цель или статус МСП. Новые и реальные программы этот опрос не ищет.</p>
                <Button type="button" variant="outline" className="mt-4" onClick={clearPreview}>Изменить ответы</Button>
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
