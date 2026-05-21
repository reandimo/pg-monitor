import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';

const ctx = fs.existsSync('results.json')
  ? fs.readFileSync('results.json', 'utf-8').slice(0, 10_000)
  : 'no context';

const LP_URL = 'https://getpsillygoose.com/product/silly-4pck/';
const SHOPIFY_URL = 'https://drinkpsillygoose.com';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
const TIMEOUT_MS = 8 * 60 * 1000;

console.log(`Using model: ${MODEL} (timeout ${TIMEOUT_MS / 1000}s)`);

const ac = new AbortController();
const timeoutHandle = setTimeout(() => ac.abort(), TIMEOUT_MS);

let report = '';
let timedOut = false;
let failedReason = '';

try {
  for await (const msg of query({
    prompt: `URGENT: the Psilly Goose funnel E2E test failed. Paid ads are actively spending money driving traffic to:
${LP_URL}

Test output:
${ctx}

Stack context (important for diagnosis):
- Landing page hosted on Netlify at getpsillygoose.com. Static site, no CMS.
- Shopify store at drinkpsillygoose.com (behind Cloudflare).
- Two CTA buttons inside .product-hero__cta on the LP:
  1. Subscribe button (a.product-hero__btn--subscribe): links to ${SHOPIFY_URL}/cart/add?id=46525587521699&quantity=1&selling_plan=3053486243&return_to=/checkout
  2. One-time purchase button (a.product-hero__btn--onetime): links to ${SHOPIFY_URL}/cart/46525587521699:1
- The subscribe CTA adds to cart with a selling plan and redirects to /checkout.
- The one-time CTA adds to cart directly.
- Product variant ID: 46525587521699, selling plan: 3053486243.
- CRITICAL: when the variant ID or selling plan changes on Shopify but the LP isn't updated, Shopify returns HTTP 422 with JSON: {"status":422,"message":"Cart Error","description":"Cannot find variant"}. This is the MOST COMMON failure mode for this funnel.
- Cloudflare is on the Shopify domain (drinkpsillygoose.com), NOT on the LP (getpsillygoose.com).
- If you encounter persistent Cloudflare challenge pages on drinkpsillygoose.com, STOP early — that is informative on its own and worth reporting fast.

Tasks (be efficient — you have a hard ${TIMEOUT_MS / 1000}s wall-clock budget):
1. Visit ${LP_URL}. Verify the page loads and both CTA buttons are visible inside .product-hero__cta.
2. Click the Subscribe CTA. Check if it redirects to drinkpsillygoose.com checkout without errors (no 422 "Cart Error", no "Cannot find variant", no empty cart).
3. Go back. Click the One-time purchase CTA. Check if it redirects to drinkpsillygoose.com cart without errors.
4. If you hit a Cloudflare challenge on drinkpsillygoose.com, abort browser checks immediately and report "Cloudflare blocking runner".
5. Identify EXACTLY at which step the funnel breaks.
6. Most likely causes — consider especially:
   - Shopify variant ID changed or product disabled (46525587521699 no longer valid) → Shopify returns 422 "Cart Error" / "Cannot find variant". THE MOST COMMON FAILURE. Fix: update the variant ID in the LP href.
   - Selling plan ID changed or removed (3053486243 no longer valid) → similar 422. Fix: update selling_plan in the LP href.
   - LP down or returning errors (Netlify issue)
   - CTA buttons missing or href changed (LP code deployment broke them)
   - Shopify store down or returning 5xx
   - Cloudflare/WAF blocking GitHub Actions IPs on drinkpsillygoose.com
   - Shopify checkout errors (product out of stock, geo-block)
7. Severity: is the Ads funnel broken (purchase impossible) or just cosmetic?

Respond in English, in exactly this format:
- 🔴/🟡 SEVERITY
- DOMAIN affected: getpsillygoose.com / drinkpsillygoose.com / both
- STEP that fails (LP load / CTA visible / subscribe redirect / onetime redirect / Shopify checkout)
- LIKELY CAUSE (be specific — point to a variant ID, a selling plan, a Shopify config)
- SUGGESTED ACTION (e.g. check Shopify product status, redeploy LP, verify variant ID, contact Shopify support)`,
    options: {
      model: MODEL,
      mcpServers: {
        playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless'] },
      },
      maxTurns: 15,
      permissionMode: 'bypassPermissions',
      abortController: ac,
    },
  })) {
    if (msg.type === 'result') report = msg.result;
  }
} catch (err) {
  if (ac.signal.aborted) {
    timedOut = true;
  } else {
    failedReason = err instanceof Error ? err.message : String(err);
  }
} finally {
  clearTimeout(timeoutHandle);
}

const userIds = (process.env.SLACK_MENTION_USER_IDS ?? process.env.SLACK_MENTION_USER_ID ?? '')
  .split(/[\s,]+/)
  .filter(Boolean);

const mention = userIds.length ? userIds.map((id) => `<@${id}>`).join(' ') + ' ' : '';

let text;
if (report) {
  const partialNote = timedOut ? '\n\n_⚠️ Diagnosis truncated — wall-clock timeout reached. Conclusions may be incomplete._' : '';
  text = `${mention}🚨 *PSILLY GOOSE FUNNEL DOWN* 🚨\n_Paid Ads still spending_\n\n${report}${partialNote}`;
} else if (timedOut) {
  text = `${mention}🚨 *PSILLY GOOSE FUNNEL DOWN* 🚨\n_Paid Ads still spending_\n\n` +
    `Tests failed twice but the AI diagnose timed out after ${TIMEOUT_MS / 1000 / 60} min before producing a verdict. ` +
    `Most common cause: Cloudflare bot challenge keeping the runner from reaching drinkpsillygoose.com.\n\n` +
    `*Manual check (60 sec):* open ${LP_URL} from mobile data (not VPN/office). ` +
    `Click both CTA buttons. If they redirect to Shopify correctly → likely Cloudflare false positive. ` +
    `If they don't → real outage, pause ad spend.`;
} else {
  text = `${mention}🚨 *PSILLY GOOSE FUNNEL DOWN* 🚨\n_Paid Ads still spending_\n\n` +
    `Tests failed twice and the AI diagnose script crashed: ${failedReason || 'unknown error'}.\n\n` +
    `*Manual check required* — verify ${LP_URL} CTA buttons redirect to Shopify correctly.`;
}

const webhook = process.env.SLACK_WEBHOOK_URL;
if (!webhook) {
  console.error('SLACK_WEBHOOK_URL is not set — the report will not be published.');
  console.log(text);
  process.exit(1);
}

const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, link_names: 1 }),
});

if (!res.ok) {
  console.error(`Slack returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

console.log(text);
process.exit(0);
