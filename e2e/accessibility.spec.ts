import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, loginName: string) {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill("demo123");
  await page.getByRole("button", { name: "Войти" }).click();
}

async function expectNoSeriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = result.violations
    .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
    .map((violation) => ({ rule: violation.id, targets: violation.nodes.flatMap((node) => node.target) }));
  expect(blocking).toEqual([]);
}

test("login and client dashboard have no serious axe violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Умный кредитный кабинет" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await login(page, "client1");
  await expect(page.getByRole("heading", { name: /Узнайте возможности бизнеса/ })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Ключевые показатели" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.goto("/dashboard");
  await page.getByLabel("Точная сумма, ₽").fill("1500000");
  await page.getByLabel("Желаемый срок, месяцев").fill("12");
  await page.getByRole("button", { name: "Подобрать продукт и рассчитать" }).click();
  await expect(page.getByText("Ориентировочные условия", { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("bank queue has no serious axe violations", async ({ page }) => {
  await login(page, "bank");
  await expect(page.getByRole("heading", { name: "Очередь заявок" })).toBeVisible();
  await expect(page.getByLabel("Фильтр очереди по статусу")).toBeVisible();
  await expectNoSeriousViolations(page);

  const firstDossier = page.locator('a[href^="/bank/applications/"]').first();
  await expect(firstDossier).toBeVisible();
  await firstDossier.click();
  await expect(page.getByText("Параметры заявки")).toBeVisible();
  await expectNoSeriousViolations(page);
});
