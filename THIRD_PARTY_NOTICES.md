# THIRD_PARTY_NOTICES

Этот файл перечисляет **прямые** зависимости из `package.json`. Точные разрешённые версии npm-пакетов и транзитивное дерево зафиксированы в `package-lock.json`; лицензии транзитивных пакетов доступны в их дистрибутивах внутри `node_modules` и в npm registry.

Проект не изменяет условия лицензий перечисленных компонентов. Перед внешним распространением сборки необходимо сохранить соответствующие copyright/license notices из поставляемых пакетов и образов.

## Прямые runtime-зависимости

| Компонент | Лицензия | Назначение | Проект |
|---|---|---|---|
| `@hono/node-server` | MIT | Node.js adapter для Hono | [honojs/node-server](https://github.com/honojs/node-server) |
| `@hono/zod-openapi` | MIT | OpenAPI-маршруты и схемы | [honojs/middleware](https://github.com/honojs/middleware) |
| `@radix-ui/react-label` | MIT | Доступный label primitive | [Radix Primitives](https://www.radix-ui.com/primitives) |
| `@radix-ui/react-select` | MIT | Доступный select primitive | [Radix Primitives](https://www.radix-ui.com/primitives) |
| `@radix-ui/react-slot` | MIT | Композиция UI-компонентов | [Radix Primitives](https://www.radix-ui.com/primitives) |
| `@radix-ui/react-tabs` | MIT | Доступные вкладки | [Radix Primitives](https://www.radix-ui.com/primitives) |
| `@scalar/hono-api-reference` | MIT | Интерактивная OpenAPI-документация | [Scalar](https://github.com/scalar/scalar) |
| `better-sqlite3` | MIT | Встраиваемая SQLite БД | [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| `class-variance-authority` | Apache-2.0 | Варианты CSS-классов компонентов | [CVA](https://github.com/joe-bell/cva) |
| `clsx` | MIT | Условное объединение CSS-классов | [lukeed/clsx](https://github.com/lukeed/clsx) |
| `hono` | MIT | HTTP-фреймворк API | [Hono](https://hono.dev/) |
| `lucide-react` | ISC | Интерфейсные иконки | [Lucide](https://lucide.dev/) |
| `react` | MIT | UI runtime | [React](https://react.dev/) |
| `react-dom` | MIT | Рендеринг React в браузере | [React](https://react.dev/) |
| `react-router` | MIT | Клиентская маршрутизация | [React Router](https://github.com/remix-run/react-router) |
| `tailwind-merge` | MIT | Разрешение конфликтов utility-классов | [tailwind-merge](https://github.com/dcastil/tailwind-merge) |
| `zod` | MIT | Runtime-валидация данных | [Zod](https://zod.dev/) |

## Прямые build/test/dev-зависимости

| Компонент | Лицензия | Назначение | Проект |
|---|---|---|---|
| `@axe-core/playwright` | MPL-2.0 | Accessibility smoke-проверки в Playwright | [axe-core](https://github.com/dequelabs/axe-core) |
| `@eslint/js` | MIT | Базовые правила ESLint | [ESLint](https://eslint.org/) |
| `@playwright/test` | Apache-2.0 | Browser E2E и test runner | [Playwright](https://playwright.dev/) |
| `@types/better-sqlite3` | MIT | TypeScript-типы | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/better-sqlite3) |
| `@types/node` | MIT | TypeScript-типы Node.js | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) |
| `@types/react` | MIT | TypeScript-типы React | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) |
| `@types/react-dom` | MIT | TypeScript-типы React DOM | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) |
| `@vitejs/plugin-react` | MIT | React plugin для Vite | [vite-plugin-react](https://github.com/vitejs/vite-plugin-react) |
| `autoprefixer` | MIT | CSS vendor prefixes | [Autoprefixer](https://github.com/postcss/autoprefixer) |
| `concurrently` | MIT | Параллельный dev-запуск web/API | [concurrently](https://github.com/open-cli-tools/concurrently) |
| `cross-env` | MIT | Кроссплатформенные env-переменные npm scripts | [cross-env](https://github.com/kentcdodds/cross-env) |
| `esbuild` | MIT | Сборка server bundle | [esbuild](https://github.com/evanw/esbuild) |
| `eslint` | MIT | Статический анализ | [ESLint](https://eslint.org/) |
| `eslint-plugin-react-hooks` | MIT | Правила React Hooks | [React](https://react.dev/) |
| `eslint-plugin-react-refresh` | MIT | Проверки Fast Refresh | [eslint-plugin-react-refresh](https://github.com/ArnaudBarre/eslint-plugin-react-refresh) |
| `globals` | MIT | Наборы глобальных переменных для ESLint | [globals](https://github.com/sindresorhus/globals) |
| `postcss` | MIT | CSS processing | [PostCSS](https://postcss.org/) |
| `tailwindcss` | MIT | Utility-first CSS framework | [Tailwind CSS](https://tailwindcss.com/) |
| `tailwindcss-animate` | MIT | Animation utilities | [tailwindcss-animate](https://github.com/jamiebuilds/tailwindcss-animate) |
| `tsx` | MIT | Запуск TypeScript в dev | [tsx](https://tsx.is/) |
| `typescript` | Apache-2.0 | Компилятор и типизация | [TypeScript](https://www.typescriptlang.org/) |
| `typescript-eslint` | MIT | TypeScript parser/rules для ESLint | [typescript-eslint](https://typescript-eslint.io/) |
| `vite` | MIT | Dev server и web-сборка | [Vite](https://vite.dev/) |
| `vitest` | MIT | Unit/integration test runner | [Vitest](https://vitest.dev/) |

UI-компоненты в `src/components/ui` являются исходным кодом проекта, собранным поверх Radix/Tailwind-паттернов; отдельного runtime-пакета `shadcn` в `package.json` нет.

## Шаблонный помощник

В фактическом runtime нет AI/LLM-сервиса, модели или model weights. Помощник клиента и саммари досье формируются собственными детерминированными шаблонами с `source=template`; `/api/health` возвращает `assistantMode=template`, `llmAvailable=false`, `model=null`. Поэтому отдельный AI-runtime не входит в third-party runtime notices.


## Собственные расчётные правила

Предварительный калькулятор, ранжирование продуктов, аннуитетная экономика предложения, банковская балльная карта и направления поддержки реализованы собственными детерминированными правилами. Это не сторонняя обученная или калиброванная ML-модель. Калькулятор до заявки выдаёт ориентиры; финальный переход из `DECISION` выполняет сотрудник банка. Направления поддержки не проверяют eligibility, а рефинансирование имеет режим `ADVISORY_ONLY` / `NOT_CALCULATED` без выдуманных платежа, экономии и общей стоимости.

## Синтетические данные

Компании, пользователи, ИНН/ОГРН, финансовая отчётность, кредитные истории, новости, заявки, документы и события сгенерированы для прототипа (см. `server/seed.ts`). Они не получены от реальных клиентов; совпадения случайны.

## Моки и production-интеграции

| Область | Что делает демонстрация | Что требуется в production |
|---|---|---|
| БКИ | Provider `local-synthetic-bki/v1` читает локальные синтетические записи; конвейер и `GET /api/mocks/bki/{inn}` используют единый контракт, ответ заявки сохраняется как append-only snapshot | Договор с БКИ, защищённый API, согласия, аудит запросов, обработка недоступности и расхождений |
| ЕГРЮЛ/ЕГРИП | Provider `local-synthetic-egrul-egrip/v1` обслуживает конвейер и `GET /api/mocks/egrul/{inn}`; ответ заявки сохраняется как append-only snapshot | Авторитетный провайдер/ФНС, актуализация, контроль качества и юридических оснований |
| Скоринг | Детерминированная демонстрационная scorecard | Валидированная банковская методология/модель, model risk management, мониторинг и versioning |
| Электронная подпись | Статус документов меняется на `SIGNED` после подтверждения | Сертифицированный провайдер ЭП, проверка полномочий, криптография, timestamp и доказательная база |
| Документы | Синтетические `.txt`-файлы для чтения | Юридические шаблоны, versioning, защищённое объектное хранилище, антивирус и retention |
| Выдача средств | Переход заявки в `ISSUED`; деньги не переводятся | АБС/кредитный договор, расчётный счёт, проводки, идемпотентность и reconciliation |
| Авторизация | Demo-аккаунты и cookie-сессии | IAM/SSO, MFA, RBAC/ABAC, lifecycle доступа и fraud controls |
| Уведомления | Не отправляются | Согласованные каналы, шаблоны, предпочтения и аудит доставки |
| Текстовый помощник | Только детерминированные шаблоны, явно «без ИИ» | Если в production будет добавлен ИИ: одобренный runtime/model registry, DLP, guardrails, оценка качества и наблюдаемость |

Реальные внешние сервисы, платные API и корпоративные системы Альфа-Банка в прототипе не вызываются. Значения `OFFER`, `SIGNED` и `ISSUED` являются демонстрационными состояниями, а не юридическими или бухгалтерскими фактами.
