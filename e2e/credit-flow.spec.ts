import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, loginName: string) {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill("demo123");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(loginName === "bank" ? /\/bank$/ : /\/dashboard$/);
}

async function logoutFromDashboard(page: Page) {
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function createApplicationViaApi(page: Page, loginName: string, amount: number, termMonths: number) {
  await login(page, loginName);
  const calculation = await page.evaluate(async ({ amount, termMonths }) => {
    const response = await fetch("/api/calculator/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, term_months: termMonths, purpose_category: "оборотные средства" }),
    });
    return { ok: response.ok, payload: await response.json() };
  }, { amount, termMonths });
  expect(calculation.ok, JSON.stringify(calculation.payload)).toBe(true);
  const calculationId = (calculation.payload as { data: { calculation_id: number } }).data.calculation_id;
  const application = await page.evaluate(async (calculationId) => {
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ calculation_id: calculationId, purpose: "Пополнение оборотных средств для тестовой ветки решения" }),
    });
    return { ok: response.ok, payload: await response.json() };
  }, calculationId);
  expect(application.ok, JSON.stringify(application.payload)).toBe(true);
  await page.context().clearCookies();
  return (application.payload as { data: { id: number; public_no: string } }).data;
}

async function openBankDossier(page: Page, applicationId: number) {
  await login(page, "bank");
  await page.goto(`/bank/applications/${applicationId}`);
  await expect(page.getByRole("button", { name: "Принять решение" })).toBeVisible();
}

async function confirmBankDecision(page: Page) {
  await page.getByRole("button", { name: "Принять решение" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить решение" }).click();
}

test("client can choose an eligible alternative and open its locked application", async ({ page }) => {
  await login(page, "client1");
  await page.getByLabel("Точная сумма, ₽").fill("1500000");
  await page.getByLabel("Желаемый срок, месяцев").fill("12");
  await page.getByRole("button", { name: "Подобрать продукт и рассчитать" }).click();
  await page.getByText(/Показать альтернативные варианты/).click();
  await page.getByRole("button", { name: "Выбрать и перейти к заявке" }).first().click();

  await expect(page).toHaveURL(/\/apply\/\d+\?calculation_id=\d+$/);
  await expect(page.getByText("Выбрано вами из подходящих")).toBeVisible();
  await expect(page.getByText("Параметры зафиксированы расчётом")).toBeVisible();
});

test("canonical client-bank flow reaches issued and recovers a lost accept response", async ({ page }) => {
  await login(page, "client1");
  await page.getByLabel("Точная сумма, ₽").fill("1500000");
  await page.getByLabel("Желаемый срок, месяцев").fill("12");
  await page.getByRole("button", { name: "Подобрать продукт и рассчитать" }).click();
  await page.getByRole("link", { name: /Перейти к заявке/ }).click();

  await page.getByLabel("Опишите потребность подробнее").fill("Закупка продуктов и упаковки для сезонного роста");
  await page.getByRole("button", { name: "Отправить заявку в банк" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить заявку" }).click();
  await expect(page).toHaveURL(/\/applications\/\d+$/);

  const applicationUrl = new URL(page.url()).pathname;
  const applicationId = applicationUrl.split("/").at(-1)!;
  const publicNumber = (await page.locator("header").getByText(/АБ-\d+/).textContent())!.trim();

  await page.getByRole("link", { name: "Кабинет" }).click();
  await logoutFromDashboard(page);

  await login(page, "bank");
  const queueSearch = page.getByLabel("Поиск по публичному номеру, ИНН или компании");
  await queueSearch.fill(publicNumber);
  await expect(page.getByRole("link", { name: new RegExp(publicNumber) })).toHaveCount(1);
  await page.getByText(publicNumber, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/bank/applications/${applicationId}$`));
  await page.getByRole("button", { name: "Подставить в форму" }).click();
  await page.getByRole("button", { name: "Принять решение" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить решение" }).click();
  await expect(page.getByText("Текущее решение")).toBeVisible();

  await page.getByRole("link", { name: "Очередь" }).click();
  await logoutFromDashboard(page);

  await login(page, "client1");
  await page.goto(applicationUrl);
  await expect(page.getByRole("button", { name: "Принять условия" })).toBeVisible();

  await page.getByRole("button", { name: "Принять условия" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();
  await expect(page.getByRole("button", { name: "Принять условия" })).toBeVisible();

  await page.route(`**/api/applications/${applicationId}/accept`, async (route) => {
    await route.fetch();
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Принять условия" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Да, принять" }).click();
  await expect(page.getByText("Ознакомьтесь с документами перед demo-подписанием")).toBeVisible();

  const previews = page.getByRole("button", { name: /Открыть текстовый предпросмотр документа/ });
  await expect(previews).toHaveCount(3);
  await previews.first().click();
  await expect(page.getByRole("heading", { name: /Предпросмотр:/ })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть" }).click();

  const downloads = page.getByRole("button", { name: /Скачать файл документа/ });
  await expect(downloads).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const downloadPromise = page.waitForEvent("download");
    await downloads.nth(index).click();
    await downloadPromise;
  }
  await page.getByRole("button", { name: "Обновить" }).click();
  await page.getByRole("button", { name: "Подтвердить ознакомление со всем пакетом" }).click();
  await page.getByRole("button", { name: "Подтвердить только demo-подписание" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить demo-подписание" }).click();
  await expect(page.locator("#main-content").getByText("Документы подписаны — ожидается выдача")).toBeVisible();

  await page.getByRole("link", { name: "Кабинет" }).click();
  await logoutFromDashboard(page);
  await login(page, "bank");
  await page.goto(`/bank/applications/${applicationId}`);
  await page.getByRole("button", { name: "Подтвердить модельную выдачу" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить модельную выдачу" }).click();
  await expect(page.getByText("Текущее решение")).toBeVisible();

  await page.getByRole("link", { name: "Очередь" }).click();
  await logoutFromDashboard(page);
  await login(page, "client1");
  await page.goto(applicationUrl);
  await expect(page.getByText("Модельная выдача подтверждена")).toBeVisible();
  await expect(page.getByText("Demo-результат, не банковская операция")).toBeVisible();
});

test("conditions, more-info and reject decisions are visible to the client", async ({ page }) => {
  const conditionsApplication = await createApplicationViaApi(page, "client2", 8_000_000, 24);
  await openBankDossier(page, conditionsApplication.id);
  await page.getByRole("button", { name: "Изменить условия" }).click();
  await page.getByLabel("Сумма, ₽").fill("7500000");
  await page.getByLabel("Обоснование").fill("Предлагаем меньшую сумму для устойчивой долговой нагрузки");
  await confirmBankDecision(page);
  await page.context().clearCookies();
  await login(page, "client2");
  await page.goto(`/applications/${conditionsApplication.id}`);
  await expect(page.getByText("Банк предлагает альтернативные условия")).toBeVisible();

  await page.context().clearCookies();
  const moreInfoApplication = await createApplicationViaApi(page, "client1", 1_500_000, 12);
  await openBankDossier(page, moreInfoApplication.id);
  await page.getByRole("button", { name: "Запросить инфо" }).click();
  await page.getByLabel("Что требуется").click();
  await page.getByRole("option", { name: "Пояснение клиента" }).click();
  await page.getByLabel("Точная причина и инструкция клиенту").fill("Поясните назначение крупного платежа поставщику");
  await confirmBankDecision(page);
  await page.context().clearCookies();
  await login(page, "client1");
  await page.goto(`/applications/${moreInfoApplication.id}`);
  await expect(page.getByText("Запрос дополнительной информации")).toBeVisible();
  await expect(page.getByText("Поясните назначение крупного платежа поставщику", { exact: true })).toBeVisible();

  await page.context().clearCookies();
  const rejectedApplication = await createApplicationViaApi(page, "client3", 1_000_000, 12);
  await openBankDossier(page, rejectedApplication.id);
  await page.getByRole("button", { name: "Отказать" }).click();
  await page.getByLabel("Обоснование").fill("Длительная просрочка требует восстановления платёжной дисциплины");
  await confirmBankDecision(page);
  await page.context().clearCookies();
  await login(page, "client3");
  await page.goto(`/applications/${rejectedApplication.id}`);
  await expect(page.getByText("Длительная просрочка требует восстановления платёжной дисциплины").first()).toBeVisible();
});
