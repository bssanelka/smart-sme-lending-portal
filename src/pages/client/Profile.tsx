import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  BadgePercent,
  Building2,
  CircleAlert,
  ClipboardList,
  Clock3,
  Landmark,
  Send,
  ShieldCheck,
  TrendingUp,
  UserRound,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import TermHint, { type TermKey } from "@/components/TermHint";
import { api, fmtMoney, type BenefitSuggestion, type ClientProfile } from "@/lib/api";

type DemoBenefitSuggestion = BenefitSuggestion & {
  applicability: {
    region: string;
    scope: string;
  };
  source: {
    catalog: string;
    entry: string;
    version: string;
    updatedAt: string;
  };
  observedCriteria: string[];
  unknownCriteria: string[];
  requiredEvidence: string[];
  nextStep: string;
};

const segmentLabels: Record<string, string> = {
  micro: "Микробизнес",
  small: "Малый бизнес",
  medium: "Средний бизнес",
};

function percent(value: number | null): string {
  return value === null ? "Нет данных" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function date(value: string): string {
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function MetricCard({ icon, label, term, value, hint }: { icon: ReactNode; label: string; term?: TermKey; value: string; hint: string }) {
  return (
    <Card className="gap-3 py-5">
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}<span>{label}{term && <TermHint term={term} />}</span></div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function BenefitCard({ item }: { item: DemoBenefitSuggestion }) {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const checklistItems = [
    ...item.unknownCriteria.map((label, index) => ({ id: `criterion-${index}`, label: `Подтвердить условие: ${label}` })),
    ...item.requiredEvidence.map((label, index) => ({ id: `evidence-${index}`, label: `Подготовить подтверждение: ${label}` })),
  ];
  const completedItems = checklistItems.filter(({ id }) => checkedItems[id]).length;
  const checklistId = `benefit-checklist-${item.id}`;

  const toggleItem = (id: string) => {
    setCheckedItems((current) => ({ ...current, [id]: !current[id] }));
  };

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{item.category}</Badge>
          <Badge variant="outline">Демо</Badge>
          <Badge className="border-blue-200 bg-blue-50 text-blue-800">Возможное направление</Badge>
          <Badge className="border-amber-200 bg-amber-50 text-amber-800"><CircleAlert className="mr-1 h-3.5 w-3.5" /> Требует проверки</Badge>
        </div>
        <CardTitle className="pt-2 text-xl">{item.title}</CardTitle>
        <CardDescription>{item.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-neutral-100 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Возможная польза</p>
          <p className="mt-1 text-sm font-medium">{item.benefit}</p>
        </div>

        <div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Регион</p>
            <p className="mt-1">{item.applicability.region}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Область применимости</p>
            <p className="mt-1">{item.applicability.scope}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Демонстрационный источник</p>
            <p className="mt-1">{item.source.catalog} · раздел «{item.source.entry}»</p>
            <p className="mt-1 text-xs text-muted-foreground">Версия {item.source.version} · demo-запись актуальна на {date(item.source.updatedAt)} · не официальный реестр программ</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-semibold">Выполненные наблюдаемые критерии</p>
            <p className="mb-2 text-xs text-muted-foreground">Только признаки из профиля; они не подтверждают право на поддержку.</p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {item.observedCriteria.map((criterion) => <li key={criterion}>✓ {criterion}</li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold">Неизвестные критерии</p>
            <p className="mb-2 text-xs text-muted-foreground">Их нужно сверить с официальными условиями на дату обращения.</p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {item.unknownCriteria.map((criterion) => <li key={criterion}>? {criterion}</li>)}
            </ul>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Необходимые подтверждения и документы</p>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {item.requiredEvidence.map((evidence) => <li key={evidence}>• {evidence}</li>)}
          </ul>
        </div>

        <Button
          type="button"
          variant={checklistOpen ? "outline" : "default"}
          aria-expanded={checklistOpen}
          aria-controls={checklistId}
          onClick={() => setChecklistOpen((current) => !current)}
        >
          <ClipboardList /> {checklistOpen ? "Закрыть проверку" : "Проверить соответствие"}
        </Button>

        {checklistOpen && (
          <div id={checklistId} className="space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div>
              <p className="font-semibold">Локальный checklist проверки</p>
              <p className="mt-1 text-xs text-muted-foreground">Отмечено {completedItems} из {checklistItems.length}. Отметки хранятся только на этой странице, ничего не отправляется и заявка не создаётся.</p>
            </div>
            <div className="space-y-2">
              {checklistItems.map(({ id, label }) => (
                <label key={id} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white p-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-blue-700"
                    checked={Boolean(checkedItems[id])}
                    onChange={() => toggleItem(id)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="rounded-lg bg-white p-3 text-sm">
              <p className="font-semibold">Следующий шаг</p>
              <p className="mt-1 text-muted-foreground">{item.nextStep}</p>
              <p className="mt-2 text-xs text-amber-800">Даже заполненный checklist не подтверждает соответствие и не является заявкой.</p>
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

  const retry = () => {
    setError("");
    api.clientProfile().then(setProfile).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить профиль");
    });
  };

  useEffect(() => {
    let active = true;
    api.clientProfile()
      .then((data) => { if (active) setProfile(data); })
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
              <p className="mt-2 text-sm text-white/85">{profile.user.position} · логин {profile.user.login}</p>
            </div>
            <div className="flex flex-wrap gap-2 md:max-w-xs md:justify-end">
              <Badge className="border-white/25 bg-white/15 text-white">{profile.company.form}</Badge>
              <Badge className="border-white/25 bg-white/15 text-white">{segmentLabels[profile.company.segment] ?? profile.company.segment}</Badge>
              <Badge className="border-white/25 bg-white/15 text-white">ОКВЭД {profile.company.okved_code}</Badge>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-[#EF3124]" /> Компания</CardTitle>
              <CardDescription>Сведения из синтетического реестра ЕГРЮЛ/ЕГРИП</CardDescription>
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
              <CardDescription>Последние доступные данные компании и БКИ. Статус показывает, проверил ли банк отчётность.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {latestFinancials && <div className="sm:col-span-2"><Badge className={latestFinancials.status === "VERIFIED" ? "bg-emerald-700" : "bg-amber-500"}>{latestFinancials.status === "VERIFIED" ? "Отчётность подтверждена банком" : "Данные предоставлены, проверка банка ожидается"}</Badge></div>}
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

        <section>
          <div className="mb-3">
            <h2 className="text-xl font-bold">Ключевые показатели</h2>
            <p className="text-sm text-muted-foreground">Понятные клиентские показатели без внутреннего банковского грейда</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Скор БКИ" term="bki" value={bki ? String(bki.bki_score) : "Нет данных"} hint={bki && bki.bki_score >= 700 ? "Хорошая кредитная история" : "Показатель можно улучшить платёжной дисциплиной"} />
            <MetricCard icon={<WalletCards className="h-4 w-4" />} label="Долговая нагрузка" term="pdn" value={percent(profile.indicators.pdn_percent)} hint="Доля среднемесячной выручки на обслуживание обязательств" />
            <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Динамика выручки" value={percent(profile.indicators.revenue_growth_percent)} hint="Изменение к предыдущему доступному году" />
            <MetricCard icon={<BadgePercent className="h-4 w-4" />} label="Рентабельность" value={percent(profile.indicators.margin_percent)} hint="Прибыль относительно годовой выручки" />
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Возможные направления поддержки</h2>
              <p className="text-sm text-muted-foreground">Демо-каталог по профилю компании — показано {profile.benefits.length}. Право на участие не проверялось.</p>
            </div>
            <Badge variant="outline" className="gap-1"><Clock3 className="h-3.5 w-3.5" /> Требуется проверка актуальности</Badge>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">Методика: детерминированные правила · каталог {profile.benefits_metadata.catalogVersion} · внешние данные и ИИ не использовались.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {profile.benefits.map((benefit) => <BenefitCard key={benefit.id} item={benefit as DemoBenefitSuggestion} />)}
          </div>
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{profile.benefits_disclaimer}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
