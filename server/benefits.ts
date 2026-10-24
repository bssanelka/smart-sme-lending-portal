export type BenefitMatchStatus = "POSSIBLE_DIRECTION";
export type BenefitVerificationStatus = "REQUIRES_CHECK";

export interface BenefitContext {
  company: {
    form: string;
    segment: string;
    okvedCode: string;
    ageYears: number;
  };
  financials: {
    revenue: number;
    profit: number;
    ownCapital: number;
  } | null;
  creditHistory: {
    overdueCount: number;
    worstDelayDays: number;
  } | null;
}

export interface BenefitSuggestion {
  id: string;
  title: string;
  category: string;
  status: BenefitMatchStatus;
  verificationStatus: BenefitVerificationStatus;
  demo: true;
  program: null;
  description: string;
  benefit: string;
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
  whyMatches: string[];
  requirements: string[];
}

export type BenefitPreviewSmeStatus = "micro" | "small" | "medium" | "not_sme" | "unknown";
export type BenefitPreviewPurpose = "working_capital" | "investment" | "guarantee" | "digitalization" | "consulting" | "other";

export interface BenefitPreviewAnswers {
  region: string;
  sme_status: BenefitPreviewSmeStatus;
  purpose: BenefitPreviewPurpose;
  amount?: number;
  term_months?: number;
  industry?: string;
}

export interface BenefitPreviewProfile {
  okvedCode: string;
  okvedName: string;
}

export interface BenefitPreviewItem {
  item: BenefitSuggestion;
  reasons: string[];
  unknowns: string[];
}

export interface BenefitPreviewResult {
  items: BenefitPreviewItem[];
  metadata: {
    eligibilityChecked: false;
    externalDataUsed: false;
    answersPersisted: false;
  };
}

const isSme = (segment: string) => segment === "micro" || segment === "small" || segment === "medium";
const segmentName = (segment: string) => segment === "micro" ? "микробизнес" : segment === "small" ? "малый бизнес" : "средний бизнес";
const UNKNOWN_REGION = "Регион регистрации компании не передан в демо-подбор — требуется уточнить";

const PURPOSE_LABELS: Record<BenefitPreviewPurpose, string> = {
  working_capital: "Оборотные средства",
  investment: "Оборудование или развитие",
  guarantee: "Гарантия или поручительство",
  digitalization: "Цифровизация",
  consulting: "Консультации или обучение",
  other: "Другая цель",
};

interface BenefitPreviewRule {
  compatiblePurposes: Exclude<BenefitPreviewPurpose, "other">[];
  smeOnly: boolean;
  industryOkvedPrefixes: string[] | null;
  regionalConstraints: null;
  amountLimits: null;
  termMonthsLimits: null;
}

const BENEFIT_PREVIEW_RULES: Record<string, BenefitPreviewRule> = {
  "sme-preferential-financing": {
    compatiblePurposes: ["working_capital", "investment"],
    smeOnly: true,
    industryOkvedPrefixes: null,
    regionalConstraints: null,
    amountLimits: null,
    termMonthsLimits: null,
  },
  "regional-guarantee": {
    compatiblePurposes: ["guarantee"],
    smeOnly: true,
    industryOkvedPrefixes: null,
    regionalConstraints: null,
    amountLimits: null,
    termMonthsLimits: null,
  },
  "food-service-modernization": {
    compatiblePurposes: ["investment", "digitalization"],
    smeOnly: false,
    industryOkvedPrefixes: ["56."],
    regionalConstraints: null,
    amountLimits: null,
    termMonthsLimits: null,
  },
  "construction-contract-support": {
    compatiblePurposes: ["working_capital", "guarantee"],
    smeOnly: false,
    industryOkvedPrefixes: ["41."],
    regionalConstraints: null,
    amountLimits: null,
    termMonthsLimits: null,
  },
  "trade-digitalization-support": {
    compatiblePurposes: ["digitalization"],
    smeOnly: false,
    industryOkvedPrefixes: ["46."],
    regionalConstraints: null,
    amountLimits: null,
    termMonthsLimits: null,
  },
  "young-business-support": {
    compatiblePurposes: ["consulting"],
    smeOnly: false,
    industryOkvedPrefixes: null,
    regionalConstraints: null,
    amountLimits: null,
    termMonthsLimits: null,
  },
};

function demoSource(entry: string): BenefitSuggestion["source"] {
  return {
    catalog: "Внутренний демонстрационный каталог alfa",
    entry,
    version: "benefits-demo-v1",
    updatedAt: "2026-10-23",
  };
}

type BenefitCandidate = Omit<BenefitSuggestion,
  "status" | "verificationStatus" | "demo" | "program" | "whyMatches" | "requirements"
>;

export function selectBenefits(context: BenefitContext): BenefitSuggestion[] {
  const suggestions: BenefitCandidate[] = [];
  const revenue = context.financials?.revenue ?? 0;
  const hasLongOverdue = (context.creditHistory?.worstDelayDays ?? 0) > 30;

  if (isSme(context.company.segment) && (revenue === 0 || revenue <= 2_000_000_000)) {
    const observedCriteria = [
      `В профиле указан сегмент «${segmentName(context.company.segment)}» — это наблюдаемый признак для показа идеи.`,
    ];
    if (context.financials) {
      observedCriteria.push(`В профиле указана годовая выручка ${Math.round(revenue).toLocaleString("ru-RU")} ₽, не превышающая demo-порог 2 млрд ₽.`);
    }

    suggestions.push({
      id: "sme-preferential-financing",
      title: "Льготное финансирование для МСП",
      category: "Льготный кредит",
      description: "Возможное направление для финансирования оборотных или инвестиционных целей. Конкретная программа не подобрана, право на участие не проверено.",
      benefit: "Если в регионе и на дату обращения найдётся подходящая программа, условия финансирования могут отличаться от стандартных.",
      applicability: {
        region: "Россия; регион реализации проекта и доступность меры не определены",
        scope: "МСП, которым требуется оборотное или инвестиционное финансирование",
      },
      source: demoSource("Финансирование МСП"),
      observedCriteria,
      unknownCriteria: [
        "Наличие компании в актуальном едином реестре субъектов МСП.",
        "Соответствие отрасли, цели, суммы и срока условиям реально действующей программы.",
        context.financials
          ? "Достаточность финансового состояния по правилам выбранного банка и программы."
          : "Размер выручки и финансовое состояние: актуальная отчётность в профиле отсутствует.",
        hasLongOverdue
          ? "Допустимость длительной просрочки по правилам программы; текущую задолженность необходимо отдельно урегулировать и подтвердить."
          : "Отсутствие критической просрочки на дату фактического обращения.",
      ],
      requiredEvidence: [
        "Актуальная выписка или сведения из реестра МСП.",
        "Бухгалтерская и налоговая отчётность за требуемый программой период.",
        "Описание цели финансирования, бюджет и подтверждающие расчёты или договоры.",
        "Согласие и данные для проверки кредитной истории на дату обращения.",
      ],
      nextStep: "Уточнить регион и параметры финансирования, затем сверить их с официальными условиями действующих программ и требованиями выбранного банка.",
    });
  }

  if (isSme(context.company.segment)) {
    const observedCriteria = [
      `В профиле указан сегмент «${segmentName(context.company.segment)}» — идея показана как возможное направление для МСП.`,
    ];
    if (context.financials && context.financials.ownCapital > 0) {
      observedCriteria.push("В профиле отражён положительный собственный капитал; его размер и качество ещё не проверены.");
    }

    suggestions.push({
      id: "regional-guarantee",
      title: "Поручительство гарантийной организации",
      category: "Гарантийная поддержка",
      description: "Возможное направление на случай нехватки собственного залога. Региональная организация и конкретный продукт не выбраны.",
      benefit: "При подтверждении всех условий поручительство может покрыть часть требований кредитора к обеспечению.",
      applicability: {
        region: UNKNOWN_REGION,
        scope: "МСП с жизнеспособным проектом и недостаточным собственным обеспечением",
      },
      source: demoSource("Региональная гарантийная поддержка"),
      observedCriteria,
      unknownCriteria: [
        "Наличие действующей гарантийной меры в регионе регистрации или реализации проекта.",
        "Участие выбранного банка или кредитора в региональной программе.",
        context.financials
          ? "Достаточность финансового состояния и собственного капитала по методике участников сделки."
          : "Финансовое состояние, собственный капитал и структура обеспечения: данных в профиле нет.",
        hasLongOverdue
          ? "Возможность участия при наличии длительной просрочки; задолженность требуется урегулировать до обращения."
          : "Результат финансовой, кредитной и юридической проверки банка и гарантийной организации.",
      ],
      requiredEvidence: [
        "Регистрационные документы и актуальные сведения о компании.",
        "Финансовая отчётность и расшифровка долговой нагрузки.",
        "Документы по финансируемой сделке или проекту.",
        "Перечень имеющегося обеспечения и документы на него.",
      ],
      nextStep: "Определить регион и потенциального кредитора, затем проверить на официальных ресурсах наличие совместимой гарантийной программы.",
    });
  }

  if (context.company.okvedCode.startsWith("56.")) {
    suggestions.push({
      id: "food-service-modernization",
      title: "Поддержка модернизации общепита",
      category: "Отраслевая идея",
      description: "Возможное региональное направление для оборудования, автоматизации кухни или развития доставки. Открытый конкурс не подтверждён.",
      benefit: "При наличии подходящей меры возможны компенсация части подтверждённых затрат или более доступное финансирование оборудования.",
      applicability: {
        region: UNKNOWN_REGION,
        scope: "Проекты модернизации предприятий общественного питания",
      },
      source: demoSource("Модернизация общественного питания"),
      observedCriteria: [
        `Основной ОКВЭД ${context.company.okvedCode} в профиле относится к деятельности общественного питания.`,
      ],
      unknownCriteria: [
        "Наличие действующего конкурса или финансовой меры в нужном регионе.",
        "Допустимость конкретных расходов на оборудование, автоматизацию или доставку.",
        "Требования к сроку работы, софинансированию, занятости и отсутствию задолженности.",
      ],
      requiredEvidence: [
        "Актуальная выписка со сведениями об основном и дополнительных ОКВЭД.",
        "Коммерческие предложения или договоры на оборудование и цифровые решения.",
        "Смета проекта, календарный план и подтверждение источника софинансирования.",
        "Документы о понесённых затратах, если выбранная мера предусматривает компенсацию.",
      ],
      nextStep: "Уточнить регион и состав проекта, затем найти официальное объявление о действующей мере и сверить перечень допустимых расходов.",
    });
  }

  if (context.company.okvedCode.startsWith("41.")) {
    suggestions.push({
      id: "construction-contract-support",
      title: "Гарантийная поддержка строительных контрактов",
      category: "Отраслевая идея",
      description: "Возможное сочетание оборотного финансирования и гарантий для исполнения подтверждённых строительных контрактов.",
      benefit: "После проверки контракта и рисков возможно финансирование кассового разрыва или частичное покрытие требований к обеспечению.",
      applicability: {
        region: "Россия; ограничения кредитора и гарантийной организации не проверены",
        scope: "Исполнение документально подтверждённых строительных контрактов",
      },
      source: demoSource("Поддержка исполнения строительных контрактов"),
      observedCriteria: [
        `Основной ОКВЭД ${context.company.okvedCode} в профиле связан со строительством зданий.`,
      ],
      unknownCriteria: [
        "Наличие действующих и приемлемых для финансирования контрактов.",
        "Рентабельность проекта, график поступлений и величина кассового разрыва.",
        "Отсутствие существенных нарушений сроков и требований заказчиков.",
        "Готовность кредитора и гарантийной организации работать с конкретным контрактом.",
      ],
      requiredEvidence: [
        "Подписанные контракты и приложения к ним.",
        "Сметы, графики выполнения работ и поступления оплаты.",
        "Сведения об исполненных контрактах и претензиях заказчиков.",
        "Финансовая отчётность и документы по предлагаемому обеспечению.",
      ],
      nextStep: "Выбрать контракт для проверки, рассчитать кассовый разрыв и сверить пакет с официальными требованиями потенциального кредитора и гарантийной организации.",
    });
  }

  if (context.company.okvedCode.startsWith("46.")) {
    suggestions.push({
      id: "trade-digitalization-support",
      title: "Поддержка цифровизации торговли",
      category: "Отраслевая идея",
      description: "Возможное направление консультационной или финансовой поддержки внедрения учётных систем, электронной торговли и автоматизации склада.",
      benefit: "Если будет найдена подходящая мера, она может снизить часть допустимых затрат или помочь подготовить проект цифровизации.",
      applicability: {
        region: UNKNOWN_REGION,
        scope: "Проекты цифровизации оптовой торговли и складских операций",
      },
      source: demoSource("Цифровизация торговли"),
      observedCriteria: [
        `Основной ОКВЭД ${context.company.okvedCode} в профиле относится к оптовой торговле.`,
      ],
      unknownCriteria: [
        "Наличие открытой меры поддержки цифровизации в регионе.",
        "Соответствие выбранного программного обеспечения и подрядчика условиям меры.",
        "Допустимый состав затрат, размер софинансирования и сроки проекта.",
      ],
      requiredEvidence: [
        "План цифровизации с описанием текущего и целевого процесса.",
        "Расчёт ожидаемого эффекта и бюджета проекта.",
        "Коммерческие предложения поставщиков программного обеспечения или оборудования.",
        "Регистрационные и финансовые документы по перечню выбранной меры.",
      ],
      nextStep: "Описать проект и регион реализации, затем проверить официальные каталоги регионального центра поддержки на наличие открытой меры.",
    });
  }

  if (context.company.ageYears < 3) {
    suggestions.push({
      id: "young-business-support",
      title: "Поддержка молодого бизнеса",
      category: "Развитие бизнеса",
      description: "Возможное направление нефинансовой поддержки: консультации, обучение и помощь с бизнес-планом. Конкретная услуга не забронирована.",
      benefit: "При наличии подходящей региональной услуги можно получить помощь в доработке финансовой модели и пакета документов.",
      applicability: {
        region: UNKNOWN_REGION,
        scope: "Бизнес на ранней стадии развития; точное ограничение по возрасту зависит от меры",
      },
      source: demoSource("Развитие молодого бизнеса"),
      observedCriteria: [
        `По дате регистрации возраст бизнеса в профиле составляет ${context.company.ageYears.toFixed(1)} года — менее demo-порога 3 лет.`,
      ],
      unknownCriteria: [
        "Определение молодого бизнеса и предельный возраст компании в конкретной региональной мере.",
        "Наличие свободных мест, открытого набора или подходящего формата услуги.",
        "Дополнительные требования к отрасли, собственникам и региону ведения деятельности.",
      ],
      requiredEvidence: [
        "Актуальные регистрационные сведения о компании.",
        "Краткий бизнес-план и цели развития на 12 месяцев.",
        "Финансовая модель или основные показатели проекта.",
        "Документы, прямо указанные организатором выбранной региональной услуги.",
      ],
      nextStep: "Уточнить регион и цель развития, затем проверить официальный календарь регионального центра поддержки и условия записи на подходящую услугу.",
    });
  }

  return suggestions.map((suggestion) => ({
    ...suggestion,
    status: "POSSIBLE_DIRECTION" as const,
    verificationStatus: "REQUIRES_CHECK" as const,
    demo: true as const,
    program: null,
    whyMatches: suggestion.observedCriteria,
    requirements: [...suggestion.unknownCriteria, ...suggestion.requiredEvidence],
  }));
}

function industryAnswerMatchesProfile(industry: string, profile: BenefitPreviewProfile): boolean {
  const normalizedIndustry = industry.trim().toLocaleLowerCase("ru-RU");
  const okvedCode = profile.okvedCode.trim().toLocaleLowerCase("ru-RU");
  const okvedName = profile.okvedName.trim().toLocaleLowerCase("ru-RU");
  return normalizedIndustry === okvedCode
    || normalizedIndustry === okvedName
    || normalizedIndustry === `${okvedCode} · ${okvedName}`;
}

export function previewBenefits(
  selectedBenefits: BenefitSuggestion[],
  answers: BenefitPreviewAnswers,
  profile: BenefitPreviewProfile,
): BenefitPreviewResult {
  const evaluated = selectedBenefits.flatMap((item, originalIndex) => {
    const rule = BENEFIT_PREVIEW_RULES[item.id];
    if (!rule) {
      return [{
        item,
        reasons: ["Направление ранее отобрано сервером по каноническим данным профиля."],
        unknowns: ["Для направления нет структурированных правил совместимости с ответами опроса."],
        purposeRank: Number.MAX_SAFE_INTEGER,
        originalIndex,
      }];
    }

    if (answers.sme_status === "not_sme" && rule.smeOnly) return [];

    const purposeRank = answers.purpose === "other"
      ? 0
      : rule.compatiblePurposes.indexOf(answers.purpose);
    if (answers.purpose !== "other" && purposeRank < 0) return [];

    const reasons = ["Направление ранее отобрано сервером по каноническим данным профиля."];
    const unknowns: string[] = [];

    if (answers.purpose === "other") {
      unknowns.push("Для цели «Другая цель» в демо-каталоге нет структурированного правила совместимости; направление оставлено для ручной проверки.");
    } else {
      reasons.push(`Цель «${PURPOSE_LABELS[answers.purpose]}» явно указана как совместимая с этим направлением в конфигурации каталога.`);
    }

    if (rule.smeOnly) {
      if (answers.sme_status === "unknown") {
        unknowns.push("Статус МСП нужно подтвердить по актуальному реестру.");
      } else {
        reasons.push("Указан статус субъекта МСП, совместимый с SME-only направлением.");
      }
    }

    if (rule.regionalConstraints === null) {
      unknowns.push(`Доступность в регионе «${answers.region}» не проверена: в демо-каталоге нет подтверждённых региональных ограничений.`);
    }

    if (answers.amount !== undefined && rule.amountLimits === null) {
      unknowns.push(`Сумма ${answers.amount.toLocaleString("ru-RU")} ₽ не проверена: в демо-каталоге нет структурированных лимитов суммы.`);
    }

    if (answers.term_months !== undefined && rule.termMonthsLimits === null) {
      unknowns.push(`Срок ${answers.term_months} мес. не проверен: в демо-каталоге нет структурированных ограничений срока.`);
    }

    if (answers.industry !== undefined) {
      if (rule.industryOkvedPrefixes === null) {
        unknowns.push(`Отрасль «${answers.industry}» не проверена: у направления нет структурированных отраслевых ограничений.`);
      } else {
        const canonicalIndustryMatches = rule.industryOkvedPrefixes.some((prefix) => profile.okvedCode.startsWith(prefix));
        if (canonicalIndustryMatches && industryAnswerMatchesProfile(answers.industry, profile)) {
          reasons.push(`Отрасль в ответе совпадает с каноническим ОКВЭД ${profile.okvedCode}, по которому направление было предварительно отобрано.`);
        } else {
          unknowns.push(`Отрасль «${answers.industry}» не подтверждена: для отбора используется канонический ОКВЭД ${profile.okvedCode}, а не свободный текст ответа.`);
        }
      }
    }

    return [{ item, reasons, unknowns, purposeRank, originalIndex }];
  });

  evaluated.sort((left, right) => left.purposeRank - right.purposeRank || left.originalIndex - right.originalIndex);

  return {
    items: evaluated.map(({ item, reasons, unknowns }) => ({ item, reasons, unknowns })),
    metadata: {
      eligibilityChecked: false,
      externalDataUsed: false,
      answersPersisted: false,
    },
  };
}
