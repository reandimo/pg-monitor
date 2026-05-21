const userIds = (process.env.SLACK_MENTION_USER_IDS ?? process.env.SLACK_MENTION_USER_ID ?? '')
  .split(/[\s,]+/)
  .filter(Boolean);

const mention = userIds.length ? userIds.map((id) => `<@${id}>`).join(' ') + ' ' : '';

const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

const text = `${mention}🚨 *PSILLY GOOSE FUNNEL DOWN* 🚨
_Paid Ads still spending_

Tests failed twice in a row but the AI diagnose did not complete (timeout or crash). Verify manually before reacting:

1. Open https://getpsillygoose.com/product/silly-4pck/ from *mobile data* (not VPN/office wifi).
2. Click both CTA buttons (Subscribe and One-time purchase).
3. If they redirect to drinkpsillygoose.com correctly → most likely a Cloudflare bot challenge against GH Actions. The funnel is fine for real users.
4. If they don't → real outage. Pause ad spend and investigate.
${runUrl ? `\nWorkflow run: ${runUrl}` : ''}`;

const webhook = process.env.SLACK_WEBHOOK_URL;
if (!webhook) {
  console.error('SLACK_WEBHOOK_URL is not set.');
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
