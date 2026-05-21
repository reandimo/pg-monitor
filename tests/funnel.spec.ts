import { test, expect } from '@playwright/test';
import { applyStealth, isCloudflareChallenge, recordTestFailure } from './utils';

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const cfChallenge = await isCloudflareChallenge(page);
  recordTestFailure(testInfo.title, cfChallenge);
});

const LP_URL = 'https://getpsillygoose.com/product/silly-4pck/';
const SHOPIFY_DOMAIN = 'drinkpsillygoose.com';

const CTA_CONTAINER = '.product-hero__cta';
const SUBSCRIBE_BTN = `${CTA_CONTAINER} a.product-hero__btn--subscribe`;
const ONETIME_BTN = `${CTA_CONTAINER} a.product-hero__btn--onetime`;

const SHOPIFY_URL_RE = new RegExp(`^https://${SHOPIFY_DOMAIN.replace(/\./g, '\\.')}/`);

// Shopify error signals — the LP links directly to /cart/add or /cart/:id.
// If the variant ID or selling plan changes on Shopify but the LP isn't updated,
// Shopify returns 422 with JSON {"status":422,"message":"Cart Error","description":"Cannot find variant"}.
// It can also render an HTML error page with similar text.
const SHOPIFY_ERROR_RE = /cart error|cannot find variant|product is not available|invalid variant|unprocessable|sold out/i;

async function assertNoShopifyError(page: import('@playwright/test').Page, label: string): Promise<void> {
  const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');

  expect(bodyText, `${label}: Shopify should not show a cart/variant error`).not.toMatch(SHOPIFY_ERROR_RE);

  const title = await page.title();
  expect(title.toLowerCase(), `${label}: should not be a 404`).not.toContain('404');
  expect(title.toLowerCase(), `${label}: should not be not-found`).not.toContain('not found');
}

test.describe('Psilly Goose LP', () => {
  test.beforeEach(async ({ context }) => {
    await applyStealth(context);
  });

  test('smoke: LP loads with both CTAs visible', async ({ page }) => {
    const res = await page.goto(LP_URL, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), `LP ${LP_URL}`).toBeLessThan(400);

    await expect(page.locator(SUBSCRIBE_BTN)).toBeVisible();
    await expect(page.locator(ONETIME_BTN)).toBeVisible();

    const subHref = await page.locator(SUBSCRIBE_BTN).getAttribute('href');
    expect(subHref, 'subscribe href should point to Shopify').toMatch(SHOPIFY_URL_RE);

    const otHref = await page.locator(ONETIME_BTN).getAttribute('href');
    expect(otHref, 'one-time href should point to Shopify').toMatch(SHOPIFY_URL_RE);
  });

  test('e2e: subscribe CTA redirects to Shopify without error', async ({ page }) => {
    // Intercept the Shopify response to capture the HTTP status, since
    // Playwright's page.goto on a cross-origin link from a click doesn't
    // expose the response object the same way.
    let shopifyStatus: number | null = null;
    page.on('response', (resp) => {
      if (resp.url().includes(SHOPIFY_DOMAIN) && resp.request().resourceType() === 'document') {
        shopifyStatus = resp.status();
      }
    });

    await page.goto(LP_URL, { waitUntil: 'domcontentloaded' });

    const subscribeBtn = page.locator(SUBSCRIBE_BTN);
    await expect(subscribeBtn).toBeVisible();
    await subscribeBtn.click();

    await page.waitForURL(`https://${SHOPIFY_DOMAIN}/**`, { timeout: 15_000 });

    expect(page.url(), 'should land on Shopify domain').toMatch(SHOPIFY_URL_RE);

    if (shopifyStatus !== null) {
      expect(shopifyStatus, `Shopify returned HTTP ${shopifyStatus} — expected 200 (422 = invalid variant/selling plan, 404 = missing page, 5xx = store down)`).toBe(200);
    }

    await assertNoShopifyError(page, 'subscribe CTA');
  });

  test('e2e: one-time purchase CTA redirects to Shopify without error', async ({ page }) => {
    let shopifyStatus: number | null = null;
    page.on('response', (resp) => {
      if (resp.url().includes(SHOPIFY_DOMAIN) && resp.request().resourceType() === 'document') {
        shopifyStatus = resp.status();
      }
    });

    await page.goto(LP_URL, { waitUntil: 'domcontentloaded' });

    const onetimeBtn = page.locator(ONETIME_BTN);
    await expect(onetimeBtn).toBeVisible();
    await onetimeBtn.click();

    await page.waitForURL(`https://${SHOPIFY_DOMAIN}/**`, { timeout: 15_000 });

    expect(page.url(), 'should land on Shopify domain').toMatch(SHOPIFY_URL_RE);

    if (shopifyStatus !== null) {
      expect(shopifyStatus, `Shopify returned HTTP ${shopifyStatus} — expected 200 (422 = invalid variant, 404 = missing page, 5xx = store down)`).toBe(200);
    }

    await assertNoShopifyError(page, 'one-time CTA');
  });
});
