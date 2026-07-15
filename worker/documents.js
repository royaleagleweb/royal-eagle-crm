// Port of src/services/documents.js. The templating is unchanged — the only
// difference is that settings are passed in (D1 is async, so the caller loads
// them) instead of being read synchronously from the database.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(amount, symbol) {
  return `${symbol}${Number(amount || 0).toFixed(2)}`;
}

/**
 * Renders a proposal or invoice as a self-contained, print-ready HTML page
 * (usable directly as an email body or printed to PDF by the browser).
 */
export function renderDocument({ kind, doc, items, company, contact, settings }) {
  const sym = settings.currency_symbol || '$';
  const isInvoice = kind === 'invoice';
  const title = isInvoice ? 'INVOICE' : 'PROPOSAL';
  const accent = '#1a3c6e';

  const rows = items
    .map(
      (item) => `
      <tr>
        <td>${esc(item.description)}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${money(item.unit_price, sym)}</td>
        <td class="num">${money(item.amount, sym)}</td>
      </tr>`
    )
    .join('');

  const clientLines = [
    company && company.name,
    contact && [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    (contact && contact.email) || (company && company.email),
    company && company.address,
    company && [company.city, company.country].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .map((line) => `<div>${esc(line)}</div>`)
    .join('');

  const paidBlock = isInvoice && doc.amount_paid > 0
    ? `<tr><td>Amount Paid</td><td class="num">-${money(doc.amount_paid, sym)}</td></tr>
       <tr class="grand"><td>Balance Due</td><td class="num">${money(doc.total - doc.amount_paid, sym)}</td></tr>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title} ${esc(doc.number)}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; margin: 0; padding: 40px; }
  .header { display: flex; justify-content: space-between; border-bottom: 3px solid ${accent}; padding-bottom: 20px; }
  .brand h1 { color: ${accent}; margin: 0 0 4px; font-size: 24px; }
  .brand div { color: #666; font-size: 13px; }
  .doc-meta { text-align: right; }
  .doc-meta h2 { color: ${accent}; margin: 0; font-size: 28px; letter-spacing: 2px; }
  .doc-meta div { font-size: 13px; color: #444; margin-top: 2px; }
  .status { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 10px; font-size: 12px;
            text-transform: uppercase; background: #eef3fa; color: ${accent}; }
  .parties { margin: 28px 0; font-size: 13px; }
  .parties h3 { font-size: 11px; text-transform: uppercase; color: #888; margin: 0 0 6px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  table.items th { background: ${accent}; color: #fff; text-align: left; padding: 8px 10px; }
  table.items td { padding: 8px 10px; border-bottom: 1px solid #eee; }
  .num { text-align: right; white-space: nowrap; }
  table.totals { margin-left: auto; margin-top: 14px; font-size: 13px; min-width: 260px; border-collapse: collapse; }
  table.totals td { padding: 5px 10px; }
  table.totals tr.grand td { font-weight: bold; font-size: 15px; border-top: 2px solid ${accent}; color: ${accent}; }
  .notes { margin-top: 34px; font-size: 12px; color: #555; }
  .notes h3 { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 4px; }
  .footer { margin-top: 44px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <h1>${esc(settings.company_name)}</h1>
      <div>${esc(settings.company_website || '')}</div>
      <div>${esc(settings.company_email || '')}</div>
      <div>${esc(settings.company_phone || '')}</div>
      <div>${esc(settings.company_address || '')}</div>
    </div>
    <div class="doc-meta">
      <h2>${title}</h2>
      <div><strong>${esc(doc.number)}</strong></div>
      <div>Issue date: ${esc(doc.issue_date)}</div>
      <div>${isInvoice ? `Due date: ${esc(doc.due_date || '-')}` : `Valid until: ${esc(doc.valid_until || '-')}`}</div>
      <span class="status">${esc(doc.status)}</span>
    </div>
  </div>

  <div class="parties">
    <h3>${isInvoice ? 'Bill To' : 'Prepared For'}</h3>
    ${clientLines || '<div>—</div>'}
  </div>

  ${doc.title ? `<h3 style="color:${accent}">${esc(doc.title)}</h3>` : ''}

  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td class="num">${money(doc.subtotal, sym)}</td></tr>
    ${doc.discount > 0 ? `<tr><td>Discount</td><td class="num">-${money(doc.discount, sym)}</td></tr>` : ''}
    ${doc.tax_rate > 0 ? `<tr><td>Tax (${doc.tax_rate}%)</td><td class="num">${money(doc.tax_amount, sym)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="num">${money(doc.total, sym)}</td></tr>
    ${paidBlock}
  </table>

  ${doc.notes ? `<div class="notes"><h3>Notes</h3><div>${esc(doc.notes)}</div></div>` : ''}
  ${doc.terms ? `<div class="notes"><h3>Terms</h3><div>${esc(doc.terms)}</div></div>` : ''}

  <div class="footer">${esc(settings.company_name)} — Thank you for your business!</div>
</body>
</html>`;
}
