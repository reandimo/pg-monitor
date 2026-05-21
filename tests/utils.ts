import { Page, BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';

const FAILURE_LOG = 'failures.log';
const CF_FAILURE_LOG = 'cf-failures.log';

const CF_URL_RE = /cdn-cgi\/challenge-platform|__cf_chl_|\/cdn-cgi\/l\/chk_/i;
const CF_TITLE_RE = /just a moment|attention required|cloudflare|sorry, you have been blocked/i;
const CF_BODY_RE = /verifying you are human|checking your browser|enable javascript and cookies|cloudflare ray id|please wait while your request is being verified/i;

export async function isCloudflareChallenge(page: Page): Promise<boolean> {
  try {
    if (CF_URL_RE.test(page.url())) return true;

    const title = await page.title().catch(() => '');
    if (CF_TITLE_RE.test(title)) return true;

    const bodyText = await page.locator('body').innerText({ timeout: 1_500 }).catch(() => '');
    if (CF_BODY_RE.test(bodyText)) return true;

    return false;
  } catch {
    return false;
  }
}

export function recordTestFailure(testTitle: string, isCfChallenge: boolean): void {
  try {
    fs.appendFileSync(FAILURE_LOG, `${testTitle}\n`);
    if (isCfChallenge) {
      fs.appendFileSync(CF_FAILURE_LOG, `${testTitle}\n`);
    }
  } catch {
    // best-effort
  }
}

export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    const realAppVersion = navigator.appVersion.replace(/HeadlessChrome/g, 'Chrome');
    Object.defineProperty(navigator, 'appVersion', {
      get: () => realAppVersion,
    });

    const realUA = navigator.userAgent.replace(/HeadlessChrome/g, 'Chrome');
    Object.defineProperty(navigator, 'userAgent', {
      get: () => realUA,
    });

    if (!('chrome' in window)) {
      (window as unknown as { chrome: object }).chrome = { runtime: {} };
    }

    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' },
      ],
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
      navigator.permissions.query = (params: PermissionDescriptor) =>
        params.name === 'notifications'
          ? Promise.resolve({
              state: Notification.permission as PermissionState,
              onchange: null,
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            } as PermissionStatus)
          : originalQuery(params);
    }
  });
}
