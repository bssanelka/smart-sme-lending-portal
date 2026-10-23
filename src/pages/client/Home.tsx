import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { api, fmtMoney, fmtDate, type Application, type NewsItem, type Product } from "@/lib/api";
import { useAuth } from "@/auth";
import { StatusBadge } from "@/components/widgets";
import CreditCalculator from "@/components/CreditCalculator";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calculator,
  CheckCircle2,
  FileCheck2,
  FileText,
  Landmark,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";

const FINAL_STATUSES = new Set(["ISSUED", "REJECTED", "DECLINED_BY_CLIENT"]);
type LoadStatus = "loading" | "error" | "success";

function LoadingState({ label }: { label: string }) {
  return <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {label}</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-950" role="alert">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="flex-1"><p className="font-medium">Не удалось загрузить данные</p><p className="mt-1 text-sm text-red-800">{message}</p></div>
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-4 border-red-200 bg-white" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Повторить</Button>
    </div>
  );
}

export default function Home() {
  const { user, logout } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = requestedTab && ["calculator", "products", "apps", "news"].includes(requestedTab) ? requestedTab : "calculator";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsStatus, setProductsStatus] = useState<LoadStatus>("loading");
  const [productsError, setProductsError] = useState("");
  const [apps, setApps] = useState<Application[]>([]);
  const [appsStatus, setAppsStatus] = useState<LoadStatus>("loading");
  const [appsError, setAppsError] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsStatus, setNewsStatus] = useState<LoadStatus>("loading");
  const [newsError, setNewsError] = useState("");

  const loadProducts = useCallback(async () => {
    await Promise.resolve();
    setProductsStatus("loading");
    setProductsError("");
    try {
      setProducts(await api.products());
      setProductsStatus("success");
    } catch (reason) {
      setProductsError(reason instanceof Error ? reason.message : "Не удалось загрузить продукты");
      setProductsStatus("error");
    }
  }, []);
  const loadApps = useCallback(async () => {
    await Promise.resolve();
    setAppsStatus("loading");
    setAppsError("");
    try {
      setApps(await api.myApplications());
      setAppsStatus("success");
    } catch (reason) {
      setAppsError(reason instanceof Error ? reason.message : "Не удалось загрузить заявки");
      setAppsStatus("error");
    }
  }, []);
  const loadNews = useCallback(async () => {
    await Promise.resolve();
    setNewsStatus("loading");
    setNewsError("");
    try {
      setNews(await api.news());
      setNewsStatus("success");
    } catch (reason) {
      setNewsError(reason instanceof Error ? reason.message : "Не удалось загрузить новости");
      setNewsStatus("error");
    }
  }, []);
  useEffect(() => {
    let active = true;
    api.products()
      .then((data) => { if (active) { setProducts(data); setProductsStatus("success"); } })
      .catch((reason: unknown) => { if (active) { setProductsError(reason instanceof Error ? reason.message : "Не удалось загрузить продукты"); setProductsStatus("error"); } });
    api.myApplications()
      .then((data) => { if (active) { setApps(data); setAppsStatus("success"); } })
      .catch((reason: unknown) => { if (active) { setAppsError(reason instanceof Error ? reason.message : "Не удалось загрузить заявки"); setAppsStatus("error"); } });
    api.news()
      .then((data) => { if (active) { setNews(data); setNewsStatus("success"); } })
      .catch((reason: unknown) => { if (active) { setNewsError(reason instanceof Error ? reason.message : "Не удалось загрузить новости"); setNewsStatus("error"); } });
    return () => { active = false; };
  }, []);

  const activeApplications = appsStatus === "success" ? apps.filter((application) => !FINAL_STATUSES.has(application.status)).length : null;
  const showCalculator = () => {
    setActiveTab("calculator");
    window.requestAnimationFrame(() => {
      const financing = document.getElementById("financing");
      financing?.scrollIntoView({ behavior: "smooth", block: "start" });
      financing?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EF3124] text-lg font-black text-white">A</div>
            <div>
              <span className="block text-sm font-bold leading-tight sm:text-base">Кредитный кабинет</span>
              <span className="hidden text-[11px] text-muted-foreground sm:block">Финансирование для бизнеса</span>
            </div>
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <span className="mr-2 hidden text-muted-foreground lg:inline">{user?.name}</span>
            <Button asChild variant="ghost" size="sm">
              <Link to="/profile"><UserRound className="h-4 w-4" /> <span className="hidden sm:inline">Профиль и льготы</span><span className="sm:hidden">Профиль</span></Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>Выйти</Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="mx-auto max-w-6xl px-4 pb-6 pt-5 sm:pt-8">
          <div className="relative overflow-hidden rounded-[2rem] bg-neutral-950 text-white shadow-2xl shadow-neutral-300/50">
            <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-[#EF3124]/30 blur-3xl" />
            <div className="absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="relative grid gap-8 p-6 sm:p-9 lg:grid-cols-[1.25fr_0.75fr] lg:gap-12 lg:p-12">
              <div className="flex flex-col justify-center">
                <Badge className="mb-5 w-fit border-white/15 bg-white/10 text-white hover:bg-white/10">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-300" /> Предварительные условия до заявки
                </Badge>
                <h1 className="max-w-3xl text-3xl font-black tracking-tight sm:text-5xl sm:leading-[1.08]">
                  Узнайте возможности бизнеса <span className="text-[#ff5a50]">до разговора с банком</span>
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-300 sm:text-lg">
                  Укажите цель, сумму и срок. Система подберёт продукт, рассчитает ориентировочные условия и покажет, что может повлиять на решение.
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <Button size="lg" onClick={showCalculator} className="h-13 bg-[#c52218] px-6 text-base text-white hover:bg-[#a91b13]">
                    Рассчитать условия <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-13 border-white/20 bg-white/5 px-6 text-base text-white hover:bg-white/10 hover:text-white">
                    <Link to="/profile">Мои данные и льготы</Link>
                  </Button>
                </div>
                <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-300">
                  <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Без выбора банковского продукта</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Понятные факторы оценки</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Решение принимает сотрудник</span>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Путь к финансированию</p>
                <div className="mt-5 space-y-1">
                  <div className="flex gap-4 rounded-2xl bg-white/10 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EF3124] text-white"><Calculator className="h-5 w-5" /></div>
                    <div><p className="font-semibold">1. Рассчитайте</p><p className="mt-1 text-sm text-neutral-400">Цель, точная сумма и желаемый срок</p></div>
                  </div>
                  <div className="ml-5 h-4 border-l border-dashed border-white/25" />
                  <div className="flex gap-4 rounded-2xl border border-white/10 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white"><FileCheck2 className="h-5 w-5" /></div>
                    <div><p className="font-semibold">2. Подайте заявку</p><p className="mt-1 text-sm text-neutral-400">Условия зафиксируются без повторного ввода</p></div>
                  </div>
                  <div className="ml-5 h-4 border-l border-dashed border-white/25" />
                  <div className="flex gap-4 rounded-2xl border border-white/10 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white"><Landmark className="h-5 w-5" /></div>
                    <div><p className="font-semibold">3. Получите решение</p><p className="mt-1 text-sm text-neutral-400">Банк проверит данные и предложит условия</p></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 mx-3 -mt-1 grid rounded-2xl border bg-white shadow-lg sm:mx-8 sm:-mt-5 sm:grid-cols-3">
            <div className="flex items-center gap-3 border-b p-4 sm:border-b-0 sm:border-r sm:p-5">
              <div className="rounded-xl bg-red-50 p-2.5 text-[#EF3124]"><TrendingUp className="h-5 w-5" /></div>
              <div><p className="text-lg font-bold">До заявки</p><p className="text-xs text-muted-foreground">соответствие, ставка и платёж</p></div>
            </div>
            <div className="flex items-center gap-3 border-b p-4 sm:border-b-0 sm:border-r sm:p-5">
              <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><ShieldCheck className="h-5 w-5" /></div>
              <div><p className="text-lg font-bold">Без автосогласия</p><p className="text-xs text-muted-foreground">финальное решение за банком</p></div>
            </div>
            <div className="flex items-center gap-3 p-4 sm:p-5">
              <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><Building2 className="h-5 w-5" /></div>
              <div>
                <p className="text-lg font-bold">{appsStatus === "loading" ? "…" : appsStatus === "error" ? "—" : activeApplications || "Нет"}</p>
                <p className="text-xs text-muted-foreground">{appsStatus === "loading" ? "загрузка активных заявок" : appsStatus === "error" ? "не удалось загрузить заявки" : activeApplications ? "активных заявок" : "активных заявок сейчас"}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="financing" tabIndex={-1} className="scroll-mt-20 border-y bg-white outline-none focus-visible:ring-2 focus-visible:ring-[#EF3124]">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
            <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#b42318]">Личный кабинет</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Управляйте финансированием в одном месте</h2>
              </div>
              <p className="max-w-md text-sm text-muted-foreground">Начните с расчёта или вернитесь к заявке, которая уже находится на рассмотрении.</p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="mb-5 overflow-x-auto pb-1">
                <TabsList>
                  <TabsTrigger value="calculator">Калькулятор</TabsTrigger>
                  <TabsTrigger value="products">Продукты</TabsTrigger>
                  <TabsTrigger value="apps">Мои заявки {appsStatus === "success" && apps.length > 0 && `(${apps.length})`}</TabsTrigger>
                  <TabsTrigger value="news">Лента для бизнеса</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="calculator">
                <CreditCalculator />
              </TabsContent>

              <TabsContent value="products">
                {productsStatus === "loading" ? (
                  <LoadingState label="Загружаем продукты…" />
                ) : productsStatus === "error" ? (
                  <ErrorState message={productsError} onRetry={loadProducts} />
                ) : products.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-8 text-center"><Landmark className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">Продуктов пока нет</p><p className="mt-1 text-sm text-muted-foreground">Доступные предложения появятся здесь.</p></div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {products.map((product) => (
                      <Card key={product.id} className="transition-shadow hover:shadow-md">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-lg">{product.name}</CardTitle>
                            <CardDescription>{product.tagline}</CardDescription>
                          </div>
                          <Badge className="border-red-200 bg-red-50 text-[#EF3124]">от {product.rate_from}%</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">{product.description}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(JSON.parse(product.features) as string[]).map((feature) => (
                            <Badge key={feature} variant="secondary" className="font-normal">{feature}</Badge>
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">{fmtMoney(product.min_amount)} — {fmtMoney(product.max_amount)} · {product.term_min}–{product.term_max} мес.</span>
                          <Button size="sm" onClick={showCalculator}>Рассчитать <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                        </div>
                      </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="apps">
                {appsStatus === "loading" ? (
                  <LoadingState label="Загружаем заявки…" />
                ) : appsStatus === "error" ? (
                  <ErrorState message={appsError} onRetry={loadApps} />
                ) : apps.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-8 text-center">
                    <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-3 font-medium">Заявок пока нет</p>
                    <p className="mt-1 text-sm text-muted-foreground">Начните с предварительного расчёта подходящих условий.</p>
                    <Button className="mt-4" onClick={showCalculator}>Перейти к расчёту</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {apps.map((application) => (
                      <Link key={application.id} to={`/applications/${application.id}`} className="block">
                        <Card className="cursor-pointer transition-shadow hover:shadow-md">
                          <CardContent className="flex items-center justify-between py-4">
                            <div>
                              <p className="font-semibold">{application.product_name}</p>
                              <p className="text-xs text-muted-foreground">{application.public_no} · {fmtMoney(application.amount)} на {application.term_months} мес. · {fmtDate(application.created_at)}</p>
                            </div>
                            <StatusBadge status={application.status} label={application.status_label} />
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="news">
                {newsStatus === "loading" ? (
                  <LoadingState label="Загружаем новости…" />
                ) : newsStatus === "error" ? (
                  <ErrorState message={newsError} onRetry={loadNews} />
                ) : news.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-8 text-center"><FileText className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">Новостей пока нет</p><p className="mt-1 text-sm text-muted-foreground">Новые материалы для бизнеса появятся здесь.</p></div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {news.map((item) => (
                    <Card key={item.id} className={item.personalized ? "border-[#EF3124]/40" : ""}>
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-2">
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
                            <div className="mt-2 flex items-center gap-2">
                              {item.personalized && (
                                <Badge className="border-red-200 bg-red-50 text-[10px] text-[#EF3124]">
                                  <Sparkles className="mr-1 h-3 w-3" /> под ваш вид деятельности
                                </Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground">{fmtDate(item.published_at)}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#b42318]">Не просто калькулятор</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Понятный путь вместо заявки вслепую</h2>
            <p className="mt-3 text-muted-foreground">Кабинет помогает сопоставить потребность бизнеса с требованиями финансирования ещё до ручной проверки банка.</p>
          </div>
          <div className="mt-7 grid gap-4 md:grid-cols-3">
            <Card className="border-0 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-[#EF3124]"><Calculator className="h-5 w-5" /></div>
                <h3 className="font-semibold">Реалистичный ориентир</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">До заявки видны примерная ставка, платёж, переплата и кредитный потенциал.</p>
              </CardContent>
            </Card>
            <Card className="border-0 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Lightbulb className="h-5 w-5" /></div>
                <h3 className="font-semibold">Варианты улучшения</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Система объясняет ключевые факторы и предлагает проверить сумму, срок или рефинансирование.</p>
              </CardContent>
            </Card>
            <Card className="border-0 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Landmark className="h-5 w-5" /></div>
                <h3 className="font-semibold">Честное решение банка</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Автоматизация готовит предварительную оценку, а финальные условия утверждает сотрудник.</p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 flex flex-col items-start justify-between gap-5 rounded-3xl bg-[#b42318] p-6 text-white sm:flex-row sm:items-center sm:p-8">
            <div>
              <p className="text-xl font-bold">Начните с потребности бизнеса</p>
              <p className="mt-1 text-sm text-white">Расчёт не является офертой и не создаёт заявку без вашего подтверждения.</p>
            </div>
            <Button onClick={showCalculator} size="lg" className="w-full bg-white text-neutral-950 hover:bg-neutral-100 sm:w-auto">
              Открыть калькулятор <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Демонстрационный прототип умного кредитного кабинета. Все данные синтетические.</p>
          <div className="flex gap-4"><Link to="/profile" className="hover:text-foreground">Профиль и льготы</Link><button type="button" onClick={showCalculator} className="hover:text-foreground">Калькулятор</button></div>
        </div>
      </footer>
    </div>
  );
}
