// Email for Workers — no SMTP sockets on the Workers runtime, so delivery
// goes through the Resend HTTP API when RESEND_API_KEY is set. Without it,
// behaves exactly like src/services/email.js dev mode: logs and resolves
// with { delivered: false, dev: true } so "send" flows still work.

export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:dev] to=${to} subject="${subject}" (RESEND_API_KEY not configured, email not actually sent)`);
    return { delivered: false, dev: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'onboarding@resend.dev',
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Email delivery failed (${res.status}): ${detail.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  return { delivered: true, messageId: data.id };
}
