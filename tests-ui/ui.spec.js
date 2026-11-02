import { test, expect } from "@playwright/test";

// Все сценарии — на обезличенном моке (?mock=..., работает только в DEV-сборке).

async function open(page, query, { width = 680, height = 820 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?${query}`);
  await page.waitForSelector(".row", { timeout: 15000 });
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => {
    const list = document.querySelector(".list");
    const row = document.querySelector(".row");
    return {
      doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      list: !list || list.scrollWidth <= list.clientWidth + 1,
      row: !row || row.scrollWidth <= row.clientWidth + 1,
    };
  });
}

test("claim-available: плашка с кнопкой появляется автоматически, без ручного refresh", async ({ page }) => {
  await open(page, "mock=claim-available&lang=ru", { width: 520, height: 640 });
  const strip = page.locator(".claim-strip:not(.muted)").first();
  await expect(strip).toBeVisible({ timeout: 10000 });
  await expect(strip.locator(".claim-name")).toHaveText("Mock Weekend Pack");
  await expect(strip.locator(".btn-claim")).toBeVisible();
  const scroll = await noHorizontalScroll(page);
  expect(scroll.doc).toBeTruthy();
  expect(scroll.list).toBeTruthy();
  expect(scroll.row).toBeTruthy();
});

test("claim-error: отдельное состояние с retry", async ({ page }) => {
  await open(page, "mock=claim-error&lang=ru", { width: 520, height: 640 });
  const err = page.locator(".claim-strip.err").first();
  await expect(err).toBeVisible({ timeout: 10000 });
  await expect(err.locator(".claim-retry")).toContainText("Проверить");
  await err.locator(".claim-retry").click();
  // мок продолжает ошибаться для mock-2 — состояние ошибки сохраняется, приложение живо
  await expect(page.locator(".claim-strip.err").first()).toBeVisible();
});

test("claim-none: отличимое от 'не проверено' состояние", async ({ page }) => {
  await open(page, "mock=claim-none&lang=ru", { width: 520, height: 640 });
  await expect(page.locator(".claim-strip.muted.none").first()).toContainText(
    "Доступных для получения пакетов сейчас нет",
    { timeout: 10000 },
  );
});

test("claim-available @680x820 и @900x700: нет горизонтального скролла", async ({ page }) => {
  for (const [w, h] of [[680, 820], [900, 700]]) {
    await open(page, "mock=claim-available&lang=ru", { width: w, height: h });
    await expect(page.locator(".btn-claim").first()).toBeVisible({ timeout: 10000 });
    const scroll = await noHorizontalScroll(page);
    expect(scroll.doc, `w=${w}`).toBeTruthy();
  }
});

test("long-content @520x640: имя с ellipsis, кнопки на месте, скролла нет", async ({ page }) => {
  await open(page, "mock=long-content&lang=ru", { width: 520, height: 640 });
  await page.waitForSelector(".row-name-text");
  const ellipsis = await page.evaluate(() => {
    const el = document.querySelector(".row-name-text");
    return el.scrollWidth > el.clientWidth;
  });
  expect(ellipsis).toBeTruthy();
  const scroll = await noHorizontalScroll(page);
  expect(scroll.doc).toBeTruthy();
  expect(scroll.row).toBeTruthy();
});

test("many-accounts @520x640: 13 строк, нет скролла", async ({ page }) => {
  await open(page, "mock=many-accounts&lang=ru", { width: 520, height: 640 });
  await expect(page.locator(".row")).toHaveCount(13, { timeout: 15000 });
  const scroll = await noHorizontalScroll(page);
  expect(scroll.doc).toBeTruthy();
  expect(scroll.list).toBeTruthy();
});

test("локали: ru/en/zh переключают документ и интерфейс", async ({ page }) => {
  for (const [lang, tag, needle] of [
    ["ru", "ru-RU", "Библиотека"],
    ["en", "en-US", "ACCOUNTS"],
    ["zh", "zh-CN", "账号"],
  ]) {
    await open(page, `mock=claim-none&lang=${lang}`);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.lang), lang).toBe(tag);
    await expect(page.locator(".section-head h2")).toContainText(needle, { timeout: 8000 });
  }
});

test("клавиатурная навигация: Tab доходит до кнопок", async ({ page }) => {
  await open(page, "mock=claim-available&lang=ru");
  await page.keyboard.press("Tab");
  const tag = await page.evaluate(() => document.activeElement?.tagName);
  expect(["BUTTON", "INPUT"]).toContain(tag);
});

test("масштаб 125%/150% (эмуляция): нет горизонтального скролла", async ({ page }) => {
  await open(page, "mock=claim-available&lang=ru", { width: 520, height: 640 });
  await expect(page.locator(".btn-claim").first()).toBeVisible({ timeout: 10000 });
  for (const zoom of ["1.25", "1.5"]) {
    await page.evaluate((z) => { document.body.style.zoom = z; }, zoom);
    const scroll = await noHorizontalScroll(page);
    expect(scroll.doc, `zoom=${zoom}`).toBeTruthy();
    await page.evaluate(() => { document.body.style.zoom = ""; });
  }
});
