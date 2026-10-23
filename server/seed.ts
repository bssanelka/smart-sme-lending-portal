import { db, now } from "./db";
import { applyDecision, buildScoringInput, getApplication, runConveyor, clientAcceptOffer, clientSign, issueApplication, publicNo } from "./conveyor";
import { proposeDecision } from "./scoring";
import { hashPassword } from "./security";
import { acknowledgeDocumentPackage, listDocumentMetadata, markDocumentOpened } from "./documents";

type Row = Record<string, unknown>;

export const DEMO_SEED_KEY = "synthetic-demo";
export const DEMO_SEED_VERSION = 1;

export function demoReportingYears(referenceDate = new Date()) {
  const currentYear = referenceDate.getUTCFullYear();
  return { latestYear: currentYear - 1, previousYear: currentYear - 2 };
}

const REQUIRED_LOGINS = ["client1", "client2", "client3", "bank"];
const REQUIRED_PRODUCT_CODES = ["express", "working_capital", "investment", "overdraft"];
const REQUIRED_COMPANY_INNS = ["772545678901", "7712345678", "7722334455"];

function scalarCount(sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count;
}

function missingRequiredSeedData(): string[] {
  const missing: string[] = [];
  for (const login of REQUIRED_LOGINS) {
    if (!db.prepare("SELECT 1 FROM users WHERE login = ?").get(login)) missing.push(`user:${login}`);
  }
  for (const code of REQUIRED_PRODUCT_CODES) {
    if (!db.prepare("SELECT 1 FROM products WHERE code = ?").get(code)) missing.push(`product:${code}`);
  }
  for (const inn of REQUIRED_COMPANY_INNS) {
    if (!db.prepare("SELECT 1 FROM companies WHERE inn = ?").get(inn)) missing.push(`company:${inn}`);
  }
  if (scalarCount("SELECT COUNT(*) AS count FROM financials") < 5) missing.push("financials:5+");
  if (scalarCount("SELECT COUNT(*) AS count FROM financial_reports") < 5) missing.push("financial_reports:5+");
  if (scalarCount("SELECT COUNT(*) AS count FROM credit_history") < 3) missing.push("credit_history:3+");
  if (scalarCount("SELECT COUNT(*) AS count FROM news") < 6) missing.push("news:6+");
  if (scalarCount("SELECT COUNT(*) AS count FROM applications") < 5) missing.push("applications:5+");
  return missing;
}

function hasAnyDomainData(): boolean {
  return ["users", "companies", "products", "financials", "financial_reports", "credit_history", "news", "applications"]
    .some((table) => scalarCount(`SELECT COUNT(*) AS count FROM ${table}`) > 0);
}

// Синтетические данные: все клиенты, компании, истории БКИ и финансовые показатели вымышлены.
export function seed(): "created" | "adopted" | "current" {
  const metadata = db.prepare("SELECT version FROM seed_metadata WHERE seed_key = ?").get(DEMO_SEED_KEY) as { version: number } | undefined;
  const missing = missingRequiredSeedData();

  if (metadata) {
    if (metadata.version > DEMO_SEED_VERSION) {
      throw new Error(`Версия demo seed ${metadata.version} новее поддерживаемой ${DEMO_SEED_VERSION}`);
    }
    if (metadata.version < DEMO_SEED_VERSION) {
      throw new Error(`Demo seed требует миграции с версии ${metadata.version} до ${DEMO_SEED_VERSION}`);
    }
    if (missing.length > 0) {
      throw new Error(`Demo seed версии ${metadata.version} неполон: ${missing.join(", ")}. Автоматическое удаление или восстановление данных отключено.`);
    }
    return "current";
  }

  if (hasAnyDomainData()) {
    if (missing.length > 0) {
      throw new Error(`Обнаружена частично заполненная БД без seed metadata: ${missing.join(", ")}. Требуется ручная проверка без удаления данных.`);
    }
    db.prepare("INSERT INTO seed_metadata (seed_key, version, applied_at) VALUES (?, ?, ?)")
      .run(DEMO_SEED_KEY, DEMO_SEED_VERSION, now());
    console.log(`[seed] существующий синтетический набор принят как версия ${DEMO_SEED_VERSION}`);
    return "adopted";
  }

  const createSeed = db.transaction(() => {
    populateSeedData();
    const incomplete = missingRequiredSeedData();
    if (incomplete.length > 0) {
      throw new Error(`Созданный demo seed неполон: ${incomplete.join(", ")}`);
    }
    db.prepare("INSERT INTO seed_metadata (seed_key, version, applied_at) VALUES (?, ?, ?)")
      .run(DEMO_SEED_KEY, DEMO_SEED_VERSION, now());
  });
  createSeed.immediate();
  console.log(`[seed] синтетические данные версии ${DEMO_SEED_VERSION} загружены атомарно`);
  return "created";
}

function populateSeedData() {
  const { latestYear, previousYear } = demoReportingYears();
  const insCompany = db.prepare("INSERT INTO companies (name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const insUser = db.prepare("INSERT INTO users (login, password, name, role, company_id, position) VALUES (?,?,?,?,?,?)");
  const insFin = db.prepare("INSERT INTO financials (company_id, year, revenue, profit, own_capital, monthly_obligations) VALUES (?,?,?,?,?,?)");
  const insFinancialReport = db.prepare(`INSERT INTO financial_reports (
    company_id, application_id, source_financial_id, reporting_year, revenue, profit, own_capital,
    monthly_obligations, status, source, submitted_by, verified_by, submitted_at, verified_at, created_at
  ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'VERIFIED', 'DEMO_SEED', ?, ?, ?, ?, ?)`);
  const insBki = db.prepare("INSERT INTO credit_history (company_id, bki_score, active_credits, total_debt, overdue_count, worst_delay_days, monthly_payment, updated_at) VALUES (?,?,?,?,?,?,?,?)");
  const insProduct = db.prepare("INSERT INTO products (code, name, tagline, description, min_amount, max_amount, rate_from, term_min, term_max, purpose_tags, features, min_revenue, auto_decision_grades) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insNews = db.prepare("INSERT INTO news (title, body, tags, published_at) VALUES (?,?,?,?)");

  const c1 = insCompany.run("Соколова Анна Владимировна", "ИП", "772545678901", "3217746000123456", "56.10", "Деятельность ресторанов и услуги по доставке еды", "2017-03-14", "г. Москва, ул. Тверская, д. 10", "Соколова Анна Владимировна", "micro").lastInsertRowid as number;
  const c2 = insCompany.run("ООО «Вектор Строй»", "ООО", "7712345678", "1217700345678", "41.20", "Строительство жилых и нежилых зданий", "2019-06-02", "г. Москва, Пресненская наб., д. 12", "Морозов Дмитрий Сергеевич", "small").lastInsertRowid as number;
  const c3 = insCompany.run("ООО «Импульс Трейд»", "ООО", "7722334455", "1227700554433", "46.69", "Оптовая торговля прочими потребительскими товарами", "2025-01-20", "г. Москва, Ленинградский пр., д. 80", "Ким Елена Олеговна", "micro").lastInsertRowid as number;

  const demoPasswordHash = hashPassword("demo123");
  insUser.run("client1", demoPasswordHash, "Соколова Анна Владимировна", "CLIENT", c1, "Собственник");
  insUser.run("client2", demoPasswordHash, "Морозов Дмитрий Сергеевич", "CLIENT", c2, "Генеральный директор");
  insUser.run("client3", demoPasswordHash, "Ким Елена Олеговна", "CLIENT", c3, "Финансовый директор");
  const bankId = Number(insUser.run("bank", demoPasswordHash, "Петрова Ольга Ивановна", "BANK", null, "Кредитный аналитик МСБ").lastInsertRowid);

  // Финансовая отчётность (синтетическая). Исходные строки сохранены для совместимости,
  // а рабочие snapshots явно помечены как проверенные demo-данные.
  const addVerifiedDemoReport = (companyId: number, year: number, revenue: number, profit: number, ownCapital: number, monthlyObligations: number) => {
    const legacyId = Number(insFin.run(companyId, year, revenue, profit, ownCapital, monthlyObligations).lastInsertRowid);
    const timestamp = now();
    insFinancialReport.run(companyId, legacyId, year, revenue, profit, ownCapital, monthlyObligations, bankId, bankId, timestamp, timestamp, timestamp);
  };
  addVerifiedDemoReport(c1, latestYear, 42_000_000, 5_100_000, 12_000_000, 180_000);
  addVerifiedDemoReport(c1, previousYear, 36_500_000, 3_900_000, 9_500_000, 180_000);
  addVerifiedDemoReport(c2, latestYear, 180_000_000, 14_000_000, 45_000_000, 1_200_000);
  addVerifiedDemoReport(c2, previousYear, 150_000_000, 9_500_000, 38_000_000, 1_000_000);
  addVerifiedDemoReport(c3, latestYear, 6_500_000, -800_000, 400_000, 90_000);

  // Кредитные истории из «БКИ» (синтетические)
  insBki.run(c1, 812, 1, 1_800_000, 0, 0, 95_000, now());
  insBki.run(c2, 704, 2, 12_500_000, 1, 12, 780_000, now());
  insBki.run(c3, 498, 1, 900_000, 3, 74, 62_000, now());

  insProduct.run("express", "Экспресс-кредит", "До 3 млн ₽ без залога, предварительная оценка за минуты",
    "Кредит на пополнение оборотных средств для микробизнеса. Система автоматически готовит оценку по данным БКИ и отчётности, финальное решение подтверждает сотрудник банка.",
    100_000, 3_000_000, 19.9, 3, 12, "оборотные средства,закупка товара,налоги",
    JSON.stringify(["Предварительная оценка автоматически", "Без залога", "Досрочное погашение без комиссии"]), 0, '["A","B"]');
  insProduct.run("working_capital", "Оборотный кредит", "Финансирование текущей деятельности до 30 млн ₽",
    "Классический кредит на пополнение оборотного капитала: закупка сырья, товара, оплата аренды и зарплат.",
    500_000, 30_000_000, 16.5, 6, 36, "оборотные средства,закупка сырья,аренда,зарплата",
    JSON.stringify(["Индивидуальная ставка после скоринга", "График аннуитетный или кастомный"]), 3_000_000, '["A"]');
  insProduct.run("investment", "Инвестиционный кредит", "Средства на развитие бизнеса до 150 млн ₽",
    "Долгосрочное финансирование покупки оборудования, ремонта помещений и запуска новых направлений. Возможно залоговое обеспечение.",
    1_000_000, 150_000_000, 14.9, 12, 84, "оборудование,ремонт,расширение,проект",
    JSON.stringify(["Срок до 7 лет", "Каникулы по основному долгу до 6 месяцев"]), 10_000_000, '[]');
  insProduct.run("overdraft", "Овердрафт", "Возобновляемая линия на непредвиденные расходы",
    "Резервный лимит на расчётном счёте: используете только нужную сумму, платите проценты только на фактический остаток.",
    100_000, 5_000_000, 21.0, 3, 24, "оборотные средства,резерв,налоги",
    JSON.stringify(["Плата только за использованную сумму", "Лимит восстанавливается автоматически"]), 0, '["A","B"]');

  const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
  insNews.run("Госпрограмма льготного кредитования МСП продлена на 2027 год",
    "Субъекты МСП смогут привлекать кредиты под 3–5% годовых на пополнение оборотных средств и инвестиционные цели. Условия: выручка до 2 млрд ₽, ставка по кредиту не выше ключевой.",
    "оборотные средства,проект,любой", d(1));
  insNews.run(`Обновлены требования к финансовой отчётности за ${latestYear} год`,
    `Компании на ОСНО представляют бухгалтерский баланс и отчёт о финансовых результатах за ${latestYear} год. Данные используются банками при кредитовании — своевременная сдача ускорит рассмотрение заявок.`,
    "любой", d(2));
  insNews.run("Спрос на оборудование для общепита вырос на 18%",
    "Ресторанный рынок Москвы увеличивает инвестиции в кухонное оборудование и доставку. Банки расширяют линейки инвестиционных кредитов для предприятий общепита.",
    "оборудование,56.10", d(4));
  insNews.run("Строительным компаниям упростили доступ к оборотному финансированию",
    "Банки-участники программы МСП запустили кредитные продукты с подтверждением контрактов через ЕИС — без залога недвижимости.",
    "оборотные средства,41.20", d(5));
  insNews.run("Как снизить долговую нагрузку перед подачей заявки на кредит",
    "Погашение мелких кредитов и закрытие неиспользуемых кредитных лимитов повышают скоринговую оценку в БКИ и уменьшают ПДН.",
    "любой", d(7));
  insNews.run("Налоговые каникулы для ИП: что важно знать при планировании кассовых разрывов",
    "ИП на упрощённой системе могут отложить часть платежей — используйте это при планировании потребности в оборотных средствах.",
    "налоги,оборотные средства", d(9));

  // Демонстрационные заявки в разных состояниях конвейера
  seedDemoApplications();
}

function seedDemoApplications() {
  const insApp = db.prepare(`INSERT INTO applications
    (public_no, client_id, company_id, product_id, amount, term_months, purpose, purpose_category, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const getUser = db.prepare("SELECT * FROM users WHERE login = ?");
  const getProduct = db.prepare("SELECT * FROM products WHERE code = ?");
  const bank = getUser.get("bank") as Row;
  const decideByBank = (applicationId: number, product: Row) => {
    const application = getApplication(applicationId) as Row;
    const proposal = proposeDecision(buildScoringInput(application), product.rate_from as number, application.amount as number, application.term_months as number);
    applyDecision(applicationId, {
      ...proposal,
      productId: product.id as number,
      productName: product.name as string,
    }, bank.name as string, bank.id as number);
  };

  // 1. Одобренная и выданная (client1, экспресс) — конвейер до конца
  const u1 = getUser.get("client1") as Row;
  const p1 = getProduct.get("express") as Row;
  const a1 = insApp.run(publicNo(1), u1.id, u1.company_id, p1.id, 1_500_000, 12, "Закупка продуктов и упаковки перед высоким сезоном", "оборотные средства", "SUBMITTED", now(), now()).lastInsertRowid as number;
  runConveyor(a1);
  decideByBank(a1, p1);
  clientAcceptOffer(a1);
  for (const document of listDocumentMetadata(a1)) markDocumentOpened(document.id, u1.id as number);
  acknowledgeDocumentPackage(a1, u1.id as number);
  clientSign(a1, u1.id as number);
  issueApplication(a1, bank.id as number, bank.name as string);

  // 2. На этапе кредитного решения (client2, оборотный) — ждёт аналитика
  const u2 = getUser.get("client2") as Row;
  const p2 = getProduct.get("working_capital") as Row;
  const a2 = insApp.run(publicNo(2), u2.id, u2.company_id, p2.id, 8_000_000, 24, "Закупка стройматериалов по контрактам", "оборотные средства", "SUBMITTED", now(), now()).lastInsertRowid as number;
  runConveyor(a2);

  // 3. Отказ (client3) — сотрудник банка подтвердил рекомендацию высокого риска
  const u3 = getUser.get("client3") as Row;
  const p3 = getProduct.get("express") as Row;
  const a3 = insApp.run(publicNo(3), u3.id, u3.company_id, p3.id, 2_500_000, 12, "Оплата поставщикам товара", "оборотные средства", "SUBMITTED", now(), now()).lastInsertRowid as number;
  runConveyor(a3);
  decideByBank(a3, p3);

  // 4. Одобренное предложение, ожидает ответа клиента (client1, овердрафт)
  const p4 = getProduct.get("overdraft") as Row;
  const a4 = insApp.run(publicNo(4), u1.id, u1.company_id, p4.id, 1_000_000, 12, "Резерв на непредвиденные расходы и налоги", "оборотные средства", "SUBMITTED", now(), now()).lastInsertRowid as number;
  runConveyor(a4);
  decideByBank(a4, p4);

  // 5. Предварительно оценённая заявка client2 в очереди банка (инвестиционный)
  const p5 = getProduct.get("investment") as Row;
  const a5 = insApp.run(publicNo(5), u2.id, u2.company_id, p5.id, 25_000_000, 60, "Приобретение башенного крана для расширения производства", "оборудование", "SUBMITTED", now(), now()).lastInsertRowid as number;
  runConveyor(a5);
}
