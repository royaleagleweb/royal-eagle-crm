/* Royal Eagle CRM portal — vanilla JS single-page app, QuickBooks-inspired. */
(() => {
  const root = document.getElementById('root');
  let token = localStorage.getItem('re_token');
  let me = null;
  let settings = {};

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMoney = (n) => `${settings.currency_symbol || '$'}${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
  const badge = (s) => `<span class="badge ${esc(s)}">${esc(String(s || '').replace('_', ' '))}</span>`;

  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && me) { logout(); throw new Error('Session expired — please log in again'); }
    const data = res.status === 204 ? null : await res.json();
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, isErr) {
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  const run = (fn) => async (...args) => { try { await fn(...args); } catch (e) { toast(e.message, true); } };

  // ---------- PWA: service worker ----------
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('Service worker registration failed:', err));
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'navigate' && event.data.url) location.hash = event.data.url.replace(/^#?/, '#');
    });
  }

  // Converts a URL-safe base64 VAPID public key into the Uint8Array applicationServerKey expects.
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  // ---------- modal form ----------
  // fields: [{name, label, type: text|number|date|select|textarea|checkbox|items, options, value, required, placeholder}]
  function openModal(title, fields, onSubmit, submitLabel = 'Save') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const fieldHtml = (f) => {
      if (f.type === 'select') {
        const opts = f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
        return `<div class="field"><label>${esc(f.label)}</label><select name="${f.name}">${opts}</select></div>`;
      }
      if (f.type === 'textarea') return `<div class="field"><label>${esc(f.label)}</label><textarea name="${f.name}" rows="3">${esc(f.value ?? '')}</textarea></div>`;
      if (f.type === 'checkbox') return `<div class="field"><label><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''} style="width:auto"> ${esc(f.label)}</label></div>`;
      if (f.type === 'items') {
        return `<div class="field items-editor" data-items>
          <label>Line items — pick a service or type a custom one; price is always editable</label>
          <div data-rows></div>
          <button type="button" class="secondary small add-item">+ Add line</button>
        </div>`;
      }
      return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.step ? `step="${f.step}"` : ''} placeholder="${esc(f.placeholder ?? '')}" ${f.required ? 'required' : ''}></div>`;
    };

    overlay.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><form>
      ${fields.map(fieldHtml).join('')}
      <div class="error" data-err></div>
      <div class="actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${esc(submitLabel)}</button></div>
    </form></div>`;
    document.body.appendChild(overlay);

    const itemsWrap = overlay.querySelector('[data-items]');
    if (itemsWrap) {
      const itemsField = fields.find((f) => f.type === 'items');
      const services = itemsField.services || [];
      const rows = itemsWrap.querySelector('[data-rows]');
      const addRow = (item = {}) => {
        const row = document.createElement('div');
        row.className = 'item-row' + (services.length ? ' with-svc' : '');
        const svcSelect = services.length ? `<select data-svc>
            <option value="">Custom item…</option>
            ${services.map((s) => `<option value="${s.id}" data-price="${s.unit_price}" data-name="${esc(s.name)}" ${String(item.service_id ?? '') === String(s.id) ? 'selected' : ''}>${esc(s.name)} — ${fmtMoney(s.unit_price)}/${esc(s.unit)}</option>`).join('')}
          </select>` : '';
        row.innerHTML = `${svcSelect}<input placeholder="Description" data-desc value="${esc(item.description ?? '')}">
          <input type="number" step="any" min="0" placeholder="Qty" data-qty value="${item.quantity ?? 1}">
          <input type="number" step="0.01" min="0" placeholder="Price" data-price value="${item.unit_price ?? ''}">
          <button type="button" class="secondary small" title="Remove">✕</button>`;
        row.querySelector('button').onclick = () => row.remove();
        const svc = row.querySelector('[data-svc]');
        if (svc) {
          svc.onchange = () => {
            const opt = svc.selectedOptions[0];
            if (!opt.value) return;
            row.querySelector('input[data-desc]').value = opt.dataset.name;
            row.querySelector('input[data-price]').value = opt.dataset.price;
          };
        }
        rows.appendChild(row);
      };
      const preset = itemsField.value;
      (preset && preset.length ? preset : [{}]).forEach(addRow);
      itemsWrap.querySelector('.add-item').onclick = () => addRow();
    }

    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').onclick = close;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const values = {};
      for (const f of fields) {
        if (f.type === 'items') {
          values[f.name] = [...overlay.querySelectorAll('.item-row')].map((r) => ({
            service_id: Number(r.querySelector('select[data-svc]')?.value) || null,
            description: r.querySelector('input[data-desc]').value.trim(),
            quantity: Number(r.querySelector('input[data-qty]').value || 1),
            unit_price: Number(r.querySelector('input[data-price]').value || 0),
          })).filter((it) => it.description);
        } else if (f.type === 'checkbox') values[f.name] = form.elements[f.name].checked;
        else {
          let v = form.elements[f.name].value;
          if (v === '' && f.type !== 'text') v = null;
          values[f.name] = f.type === 'number' && v !== null ? Number(v) : v;
        }
      }
      try { await onSubmit(values); close(); } catch (err) { overlay.querySelector('[data-err]').textContent = err.message; }
    };
  }

  // ---------- login ----------
  function renderLogin(showRegister) {
    root.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="logo"><div class="eagle">🦅</div><h1>Royal Eagle CRM</h1><p>Web &amp; Marketing</p></div>
      <form>
        ${showRegister ? '<label>Your name</label><input name="name" required>' : ''}
        <label>Email</label><input name="email" type="email" required autofocus>
        <label>Password</label><input name="password" type="password" required minlength="8">
        <button type="submit">${showRegister ? 'Create admin account' : 'Log in'}</button>
        <div class="login-error" data-err></div>
      </form>
      <div class="login-alt"><a href="#" data-toggle>${showRegister ? 'Back to log in' : 'First time here? Create the admin account'}</a></div>
    </div></div>`;

    root.querySelector('[data-toggle]').onclick = (e) => { e.preventDefault(); renderLogin(!showRegister); };
    root.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const path = showRegister ? '/auth/register' : '/auth/login';
        const body = { email: f.email.value, password: f.password.value };
        if (showRegister) body.name = f.name.value;
        const data = await api('POST', path, body);
        token = data.token;
        localStorage.setItem('re_token', token);
        await boot();
      } catch (err) { root.querySelector('[data-err]').textContent = err.message; }
    };
  }

  function logout() {
    token = null; me = null;
    localStorage.removeItem('re_token');
    renderLogin(false);
  }

  // ---------- shell ----------
  const NAV = [
    ['dashboard', 'Dashboard'], ['leads', 'Leads'], ['pipeline', 'Pipeline'], ['contacts', 'Contacts'],
    ['companies', 'Clients'], ['services', 'Services & Pricing'], ['proposals', 'Proposals'],
    ['invoices', 'Invoices'], ['expenses', 'Expenses'], ['files', 'Files'], ['tasks', 'Tasks'],
    ['reports', 'Reports'], ['growth', 'Growth'], ['settings', 'Settings'],
  ];

  const activeServices = async () => (await api('GET', '/services?active=true'));

  function renderShell() {
    root.innerHTML = `<div class="topbar">
        <button class="hamburger" data-menu-toggle aria-label="Menu">☰</button>
        <div class="brand-mini"><span class="eagle">🦅</span> Royal Eagle</div>
      </div>
      <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="eagle">🦅</span><strong>Royal Eagle</strong><small>Web &amp; Marketing CRM</small></div>
        <nav>${NAV.map(([r, label]) => `<a href="#/${r}" data-nav="${r}">${label}</a>`).join('')}</nav>
        <div class="user">Signed in as <strong>${esc(me.name)}</strong> (${esc(me.role)})<button data-logout>Log out</button></div>
      </aside>
      <div class="sidebar-backdrop"></div>
      <main class="main" id="view"></main>
    </div>`;
    root.querySelector('[data-logout]').onclick = logout;

    // Mobile hamburger drawer: closed by default under 768px, always visible above it (CSS handles that).
    const sidebar = root.querySelector('.sidebar');
    const backdrop = root.querySelector('.sidebar-backdrop');
    const closeDrawer = () => { sidebar.classList.remove('open'); backdrop.classList.remove('open'); };
    root.querySelector('[data-menu-toggle]').onclick = () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('open');
    };
    backdrop.onclick = closeDrawer;
    sidebar.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', closeDrawer));
  }

  const view = () => document.getElementById('view');
  const pageHead = (title, actionsHtml = '') =>
    `<div class="page-head"><h2>${esc(title)}</h2><div class="toolbar">${actionsHtml}</div></div>`;

  function table(cols, rows, rowHtml) {
    if (!rows.length) return `<div class="panel empty">Nothing here yet.</div>`;
    return `<div class="table-scroll"><table class="grid"><thead><tr>${cols.map((c) => `<th class="${c.startsWith('$') ? 'num' : ''}">${esc(c.replace('$', ''))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
  }

  async function selectOptions(path, labelFn, empty = '— none —') {
    const rows = await api('GET', path);
    return [{ value: '', label: empty }, ...rows.map((r) => ({ value: r.id, label: labelFn(r) }))];
  }
  const companyOptions = () => selectOptions('/companies', (c) => c.name);
  const contactOptions = () => selectOptions('/contacts', (c) => `${c.first_name} ${c.last_name || ''}`.trim());

  // ---------- QuickBooks-style "+ New" quick create ----------
  window.quickNew = () => {
    openModal('Create new…', [
      { name: 'what', label: 'What would you like to create?', type: 'select', options: [
        { value: 'invoice', label: 'Invoice' }, { value: 'proposal', label: 'Proposal' },
        { value: 'expense', label: 'Expense' }, { value: 'lead', label: 'Lead' },
        { value: 'contact', label: 'Contact' }, { value: 'company', label: 'Client' },
        { value: 'deal', label: 'Deal' }, { value: 'task', label: 'Task' },
        { value: 'service', label: 'Service (price list)' }, { value: 'goal', label: 'Goal (Growth)' },
      ] },
    ], async ({ what }) => {
      const creators = {
        invoice: newInvoice, proposal: newProposal, expense: newExpense, lead: newLead,
        contact: newContact, company: newCompany, deal: newDeal, task: newTask, service: newService,
        goal: newGoal,
      };
      setTimeout(creators[what], 50);
    }, 'Next');
  };

  // ---------- Dashboard (QuickBooks-style money-first overview) ----------
  async function showDashboard() {
    const d = await api('GET', '/reports/dashboard');
    const exp = await api('GET', '/expenses/summary');
    const [habitsDone, habitsTotal] = String(d.growth.habits_today).split('/').map(Number);
    const growthClass = habitsTotal === 0 ? '' : habitsDone === habitsTotal ? 'good' : habitsDone === 0 ? 'bad' : '';
    view().innerHTML = pageHead('Dashboard', `<button onclick="quickNew()">+ New</button>`) + `
      <div class="cards">
        <div class="stat good"><div class="label">Income this month</div><div class="value">${fmtMoney(d.revenue.this_month)}</div><div class="sub">${fmtMoney(d.revenue.all_time)} all time</div></div>
        <div class="stat bad"><div class="label">Expenses this month</div><div class="value">${fmtMoney(d.expenses.this_month)}</div><div class="sub">${fmtMoney(d.expenses.all_time)} all time</div></div>
        <div class="stat ${d.profit.this_month >= 0 ? 'good' : 'bad'}"><div class="label">Profit this month</div><div class="value">${fmtMoney(d.profit.this_month)}</div><div class="sub">${fmtMoney(d.profit.all_time)} all time</div></div>
        <div class="stat"><div class="label">Unpaid invoices</div><div class="value">${fmtMoney(d.outstanding_invoices.amount)}</div><div class="sub">${d.outstanding_invoices.count} open · ${d.overdue_invoices.count} overdue (${fmtMoney(d.overdue_invoices.amount)})</div></div>
        <div class="stat"><div class="label">Pipeline</div><div class="value">${fmtMoney(d.pipeline.value)}</div><div class="sub">${d.pipeline.open_deals} open deals · ${fmtMoney(d.pipeline.weighted_value)} weighted</div></div>
        <div class="stat"><div class="label">Leads</div><div class="value">${d.leads.total || 0}</div><div class="sub">${d.leads.new || 0} new · ${d.leads.qualified || 0} qualified</div></div>
        <div class="stat"><div class="label">Proposals awaiting reply</div><div class="value">${d.proposals.awaiting_response || 0}</div><div class="sub">${d.proposals.accepted || 0} accepted · ${d.proposals.draft || 0} draft</div></div>
        <div class="stat"><div class="label">Tasks due this week</div><div class="value">${d.tasks_due_this_week}</div><div class="sub"><a href="#/tasks">view tasks</a></div></div>
        <div class="stat ${growthClass}"><div class="label">Growth</div><div class="value">${esc(d.growth.habits_today)}</div><div class="sub">habits today · 🔥 ${d.growth.longest_streak} streak · ${d.growth.active_goals} active goal${d.growth.active_goals === 1 ? '' : 's'} · <a href="#/growth">view</a></div></div>
      </div>
      <div class="panel"><h3>Top services billed</h3>
        ${(d.top_services || []).length ? `<table class="grid">${d.top_services.map((s) => `<tr><td>${esc(s.service)}</td><td class="num">${fmtMoney(s.billed)}</td></tr>`).join('')}</table>` : '<div class="empty">Nothing invoiced yet — add services under <a href="#/services">Services &amp; Pricing</a>.</div>'}
      </div>
      <div class="panel"><h3>Spending by category</h3>
        ${exp.by_category.length ? `<table class="grid">${exp.by_category.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${fmtMoney(c.total)}</td></tr>`).join('')}</table>` : '<div class="empty">No expenses recorded yet.</div>'}
      </div>`;
  }

  // ---------- Services & pricing ----------
  const serviceFields = (s = {}) => [
    { name: 'name', label: 'Service name', required: true, value: s.name },
    { name: 'description', label: 'Description (shows on invoices/proposals)', type: 'textarea', value: s.description },
    { name: 'unit_price', label: 'Default price', type: 'number', step: '0.01', required: true, value: s.unit_price },
    { name: 'unit', label: 'Unit', type: 'select', value: s.unit || 'project', options: ['project', 'month', 'hour', 'page', 'article', 'campaign'].map((u) => ({ value: u, label: u })) },
  ];

  window.newService = run(async () => openModal('New service', serviceFields(),
    async (v) => { await api('POST', '/services', v); toast('Service added to price list'); route(); }));

  window.editService = run(async (id) => {
    const s = await api('GET', `/services/${id}`);
    openModal('Edit service', [...serviceFields(s), { name: 'is_active', label: 'Active (available on new invoices/proposals)', type: 'checkbox', value: !!s.is_active }],
      async (v) => { await api('PATCH', `/services/${id}`, v); toast('Service updated'); route(); });
  });

  window.delService = run(async (id) => { if (confirm('Delete this service?')) { await api('DELETE', `/services/${id}`); route(); } });

  async function showServices() {
    const [rows, revenue] = await Promise.all([api('GET', '/services'), api('GET', '/services/revenue')]);
    const billed = Object.fromEntries(revenue.map((r) => [r.service, r.billed]));
    view().innerHTML = pageHead('Services & Pricing', `<button onclick="newService()">+ New service</button>`) +
      `<p style="color:var(--muted);margin-top:-8px">Your price list. Picking a service on an invoice or proposal pre-fills its price — you can always type a custom price per line.</p>` +
      table(['Service', 'Description', '$Default price', 'Unit', '$Billed to date', 'Status', ''], rows, (s) => `<tr>
        <td><strong>${esc(s.name)}</strong></td><td>${esc(s.description || '—')}</td>
        <td class="num">${fmtMoney(s.unit_price)}</td><td>per ${esc(s.unit)}</td>
        <td class="num">${fmtMoney(billed[s.name] || 0)}</td>
        <td><span class="badge ${s.is_active ? 'accepted' : 'cancelled'}">${s.is_active ? 'active' : 'inactive'}</span></td>
        <td class="num"><button class="small" onclick="editService(${s.id})">Edit</button>
          <button class="small danger" onclick="delService(${s.id})">✕</button></td></tr>`);
  }

  // ---------- Leads ----------
  window.newLead = run(async () => openModal('New lead', [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'company_name', label: 'Company' },
    { name: 'source', label: 'Source', placeholder: 'Website form, referral, ad…' },
    { name: 'estimated_value', label: 'Estimated value', type: 'number', step: '0.01' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], async (v) => { await api('POST', '/leads', v); toast('Lead created'); route(); }));

  window.leadStatus = run(async (id, status) => { await api('PATCH', `/leads/${id}`, { status }); route(); });
  window.convertLead = run(async (id) => { await api('POST', `/leads/${id}/convert`, {}); toast('Lead converted to client + deal'); route(); });
  window.delLead = run(async (id) => { if (confirm('Delete this lead?')) { await api('DELETE', `/leads/${id}`); route(); } });

  async function showLeads() {
    const leads = await api('GET', '/leads');
    view().innerHTML = pageHead('Leads', `<button onclick="newLead()">+ New lead</button>`) +
      table(['Name', 'Company', 'Contact info', 'Source', '$Est. value', 'Status', ''], leads, (l) => `<tr>
        <td><strong>${esc(l.name)}</strong></td><td>${esc(l.company_name || '—')}</td>
        <td>${esc(l.email || '')}<br><small>${esc(l.phone || '')}</small></td>
        <td>${esc(l.source || '—')}</td><td class="num">${fmtMoney(l.estimated_value)}</td>
        <td>${badge(l.status)}</td>
        <td class="num">${l.status !== 'converted' ? `
          <select onchange="leadStatus(${l.id}, this.value)">
            ${['new', 'contacted', 'qualified', 'unqualified'].map((s) => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="small" onclick="convertLead(${l.id})">Convert</button>
          <button class="small danger" onclick="delLead(${l.id})">✕</button>` : ''}</td>
      </tr>`);
  }

  // ---------- Pipeline ----------
  window.newDeal = run(async () => openModal('New deal', [
    { name: 'title', label: 'Deal title', required: true },
    { name: 'company_id', label: 'Client', type: 'select', options: await companyOptions() },
    { name: 'value', label: 'Value', type: 'number', step: '0.01' },
    { name: 'expected_close_date', label: 'Expected close', type: 'date' },
  ], async (v) => { await api('POST', '/deals', v); toast('Deal created'); route(); }));

  window.moveDeal = run(async (id, stageId) => { await api('POST', `/deals/${id}/move`, { stage_id: Number(stageId) }); route(); });
  window.winDeal = run(async (id) => { await api('POST', `/deals/${id}/win`); toast('Deal won! 🎉'); route(); });
  window.loseDeal = run(async (id) => {
    const reason = prompt('Lost reason (optional):') ?? undefined;
    await api('POST', `/deals/${id}/lose`, { reason }); route();
  });

  async function showPipeline() {
    const board = await api('GET', '/deals/pipeline');
    const stageOpts = board.map((s) => ({ id: s.id, name: s.name }));
    view().innerHTML = pageHead('Sales pipeline', `<button onclick="newDeal()">+ New deal</button>`) + `
      <div class="kanban">${board.map((s) => `
        <div class="col"><h4>${esc(s.name)} <span>${fmtMoney(s.total_value)}</span></h4>
          ${s.deals.map((dl) => `<div class="deal">
            <div class="title">${esc(dl.title)}</div>
            <div class="meta">${esc(dl.company_name || '')} · ${fmtMoney(dl.value)}</div>
            <div class="row">
              <select onchange="moveDeal(${dl.id}, this.value)">${stageOpts.map((o) => `<option value="${o.id}" ${o.id === s.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
              <button class="small" title="Mark won" onclick="winDeal(${dl.id})">✓</button>
              <button class="small danger" title="Mark lost" onclick="loseDeal(${dl.id})">✕</button>
            </div>
          </div>`).join('') || '<div class="empty" style="padding:12px">No deals</div>'}
        </div>`).join('')}
      </div>`;
  }

  // ---------- Contacts ----------
  window.newContact = run(async () => openModal('New contact', [
    { name: 'first_name', label: 'First name', required: true },
    { name: 'last_name', label: 'Last name' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'job_title', label: 'Job title' },
    { name: 'company_id', label: 'Client', type: 'select', options: await companyOptions() },
  ], async (v) => { await api('POST', '/contacts', v); toast('Contact created'); route(); }));
  window.delContact = run(async (id) => { if (confirm('Delete this contact?')) { await api('DELETE', `/contacts/${id}`); route(); } });

  async function showContacts() {
    const rows = await api('GET', '/contacts');
    view().innerHTML = pageHead('Contacts', `<button onclick="newContact()">+ New contact</button>`) +
      table(['Name', 'Company', 'Email', 'Phone', 'Title', ''], rows, (c) => `<tr>
        <td><strong>${esc(c.first_name)} ${esc(c.last_name || '')}</strong></td>
        <td>${esc(c.company_name || '—')}</td><td>${esc(c.email || '—')}</td>
        <td>${esc(c.phone || '—')}</td><td>${esc(c.job_title || '—')}</td>
        <td class="num"><button class="small danger" onclick="delContact(${c.id})">✕</button></td></tr>`);
  }

  // ---------- Companies / clients ----------
  window.newCompany = run(async () => openModal('New client', [
    { name: 'name', label: 'Company name', required: true },
    { name: 'industry', label: 'Industry' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'website', label: 'Website' },
    { name: 'city', label: 'City' },
    { name: 'country', label: 'Country' },
  ], async (v) => { await api('POST', '/companies', v); toast('Client created'); route(); }));
  window.delCompany = run(async (id) => { if (confirm('Delete this client?')) { await api('DELETE', `/companies/${id}`); route(); } });

  async function showCompanies() {
    const [rows, report] = await Promise.all([api('GET', '/companies'), api('GET', '/reports/clients')]);
    const fin = Object.fromEntries(report.map((r) => [r.id, r]));
    view().innerHTML = pageHead('Clients', `<button onclick="newCompany()">+ New client</button>`) +
      table(['Client', 'Industry', 'Contact', '$Billed', '$Paid', '$Outstanding', ''], rows, (c) => `<tr>
        <td><strong>${esc(c.name)}</strong><br><small>${esc(c.website || '')}</small></td>
        <td>${esc(c.industry || '—')}</td><td>${esc(c.email || '')}<br><small>${esc(c.phone || '')}</small></td>
        <td class="num">${fmtMoney(fin[c.id]?.billed)}</td><td class="num">${fmtMoney(fin[c.id]?.paid)}</td>
        <td class="num">${fmtMoney(fin[c.id]?.outstanding)}</td>
        <td class="num"><button class="small danger" onclick="delCompany(${c.id})">✕</button></td></tr>`);
  }

  // ---------- Proposals ----------
  window.newProposal = run(async () => openModal('New proposal', [
    { name: 'title', label: 'Proposal title', required: true },
    { name: 'company_id', label: 'Client', type: 'select', options: await companyOptions() },
    { name: 'contact_id', label: 'Contact', type: 'select', options: await contactOptions() },
    { name: 'tax_rate', label: 'Tax rate %', type: 'number', step: '0.01', value: settings.default_tax_rate },
    { name: 'discount', label: 'Discount amount', type: 'number', step: '0.01' },
    { name: 'items', label: 'Line items', type: 'items', services: await activeServices() },
    { name: 'notes', label: 'Notes to client', type: 'textarea' },
  ], async (v) => {
    if (!v.items.length) throw new Error('Add at least one line item');
    await api('POST', '/proposals', v); toast('Proposal created'); route();
  }));

  window.sendProposal = run(async (id) => { const r = await api('POST', `/proposals/${id}/send`, {}); toast(r.email.delivered ? 'Proposal emailed to client' : 'Marked sent (SMTP not configured)'); route(); });
  window.acceptProposal = run(async (id) => { await api('POST', `/proposals/${id}/accept`); toast('Proposal accepted'); route(); });
  window.declineProposal = run(async (id) => { await api('POST', `/proposals/${id}/decline`); route(); });
  window.proposalToInvoice = run(async (id) => { const inv = await api('POST', `/proposals/${id}/convert-to-invoice`); toast(`Invoice ${inv.number} created`); location.hash = '#/invoices'; });
  window.delProposal = run(async (id) => { if (confirm('Delete this proposal?')) { await api('DELETE', `/proposals/${id}`); route(); } });

  async function showProposals() {
    const rows = await api('GET', '/proposals');
    view().innerHTML = pageHead('Proposals', `<button onclick="newProposal()">+ New proposal</button>`) +
      table(['#', 'Title', 'Client', 'Issued', '$Total', 'Status', 'Document', ''], rows, (p) => `<tr>
        <td>${esc(p.number)}</td><td><strong>${esc(p.title)}</strong></td><td>${esc(p.company_name || '—')}</td>
        <td>${fmtDate(p.issue_date)}</td><td class="num">${fmtMoney(p.total)}</td><td>${badge(p.status)}</td>
        <td><a href="/api/proposals/${p.id}/html?_t=${encodeURIComponent(token)}" onclick="return openDoc(event, 'proposals', ${p.id})">View / print</a></td>
        <td class="num">
          ${['draft', 'sent'].includes(p.status) ? `<button class="small" onclick="sendProposal(${p.id})">${p.status === 'sent' ? 'Re-send' : 'Send'}</button>` : ''}
          ${p.status === 'sent' ? `<button class="small" onclick="acceptProposal(${p.id})">Accept</button><button class="small danger" onclick="declineProposal(${p.id})">Decline</button>` : ''}
          ${p.status === 'accepted' && !p.invoice_id ? `<button class="small" onclick="proposalToInvoice(${p.id})">→ Invoice</button>` : ''}
          ${p.status !== 'accepted' ? `<button class="small danger" onclick="delProposal(${p.id})">✕</button>` : ''}
        </td></tr>`);
  }

  // Opens the printable document in a new tab (fetch with auth, then blob URL)
  window.openDoc = (e, kind, id) => {
    e.preventDefault();
    run(async () => {
      const res = await fetch(`/api/${kind}/${id}/html`, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) throw new Error('Could not load document');
      const blob = new Blob([await res.text()], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    })();
    return false;
  };

  // ---------- Invoices ----------
  window.newInvoice = run(async () => openModal('New invoice', [
    { name: 'company_id', label: 'Client', type: 'select', options: await companyOptions() },
    { name: 'contact_id', label: 'Contact', type: 'select', options: await contactOptions() },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'tax_rate', label: 'Tax rate %', type: 'number', step: '0.01', value: settings.default_tax_rate },
    { name: 'discount', label: 'Discount amount', type: 'number', step: '0.01' },
    { name: 'items', label: 'Line items', type: 'items', services: await activeServices() },
    { name: 'notes', label: 'Notes to client', type: 'textarea' },
  ], async (v) => {
    if (!v.items.length) throw new Error('Add at least one line item');
    await api('POST', '/invoices', v); toast('Invoice created'); route();
  }));

  window.sendInvoice = run(async (id) => { const r = await api('POST', `/invoices/${id}/send`, {}); toast(r.email.delivered ? 'Invoice emailed to client' : 'Marked sent (SMTP not configured)'); route(); });
  window.recordPayment = run(async (id, balance) => openModal('Record payment', [
    { name: 'amount', label: `Amount (balance ${fmtMoney(balance)})`, type: 'number', step: '0.01', value: balance, required: true },
    { name: 'payment_date', label: 'Payment date', type: 'date', value: new Date().toISOString().slice(0, 10) },
    { name: 'method', label: 'Method', type: 'select', options: ['bank_transfer', 'credit_card', 'paypal', 'stripe', 'cash', 'check', 'other'].map((m) => ({ value: m, label: m.replace('_', ' ') })) },
    { name: 'reference', label: 'Reference #' },
  ], async (v) => { await api('POST', `/invoices/${id}/payments`, v); toast('Payment recorded'); route(); }, 'Record'));
  window.cancelInvoice = run(async (id) => { if (confirm('Cancel this invoice?')) { await api('POST', `/invoices/${id}/cancel`); route(); } });

  async function showInvoices() {
    const rows = await api('GET', '/invoices');
    view().innerHTML = pageHead('Invoices', `<button onclick="newInvoice()">+ New invoice</button>`) +
      table(['#', 'Client', 'Issued', 'Due', '$Total', '$Balance', 'Status', 'Document', ''], rows, (i) => `<tr>
        <td>${esc(i.number)}</td><td><strong>${esc(i.company_name || '—')}</strong></td>
        <td>${fmtDate(i.issue_date)}</td><td>${fmtDate(i.due_date)}</td>
        <td class="num">${fmtMoney(i.total)}</td><td class="num">${fmtMoney(i.balance)}</td>
        <td>${badge(i.status)}</td>
        <td><a href="#" onclick="return openDoc(event, 'invoices', ${i.id})">View / print</a></td>
        <td class="num">
          ${!['paid', 'cancelled'].includes(i.status) ? `<button class="small" onclick="sendInvoice(${i.id})">${i.status === 'draft' ? 'Send' : 'Re-send'}</button>` : ''}
          ${!['paid', 'cancelled'].includes(i.status) ? `<button class="small" onclick="recordPayment(${i.id}, ${i.balance})">+ Payment</button>` : ''}
          ${i.status === 'draft' ? `<button class="small danger" onclick="cancelInvoice(${i.id})">Cancel</button>` : ''}
        </td></tr>`);
  }

  // ---------- Expenses ----------
  window.newExpense = run(async () => openModal('New expense', [
    { name: 'description', label: 'Description', required: true },
    { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
    { name: 'expense_date', label: 'Date', type: 'date', value: new Date().toISOString().slice(0, 10) },
    { name: 'category_id', label: 'Category', type: 'select', options: await selectOptions('/expenses/categories', (c) => c.name, '— pick a category —') },
    { name: 'vendor', label: 'Vendor / payee' },
    { name: 'company_id', label: 'Billable to client', type: 'select', options: await companyOptions() },
    { name: 'recurring_interval', label: 'Recurring', type: 'select', options: [
      { value: '', label: 'One-time' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }] },
  ], async (v) => {
    if (v.company_id) v.billable = true;
    await api('POST', '/expenses', v); toast('Expense recorded'); route();
  }));
  window.delExpense = run(async (id) => { if (confirm('Delete this expense?')) { await api('DELETE', `/expenses/${id}`); route(); } });

  async function showExpenses() {
    const [rows, summary] = await Promise.all([api('GET', '/expenses'), api('GET', '/expenses/summary')]);
    view().innerHTML = pageHead('Expenses', `<button onclick="newExpense()">+ New expense</button>`) + `
      <div class="cards">
        <div class="stat bad"><div class="label">Total spend</div><div class="value">${fmtMoney(summary.total)}</div><div class="sub">${summary.count} expenses recorded</div></div>
        ${summary.by_category.slice(0, 3).map((c) => `<div class="stat"><div class="label">${esc(c.category)}</div><div class="value">${fmtMoney(c.total)}</div><div class="sub">${c.count} items</div></div>`).join('')}
      </div>` +
      table(['Date', 'Description', 'Category', 'Vendor', 'Client', '$Amount', ''], rows, (x) => `<tr>
        <td>${fmtDate(x.expense_date)}</td>
        <td><strong>${esc(x.description)}</strong>${x.is_recurring ? ` <span class="badge">${esc(x.recurring_interval)}</span>` : ''}</td>
        <td>${esc(x.category_name || '—')}</td><td>${esc(x.vendor || '—')}</td>
        <td>${x.billable ? esc(x.company_name || '') + ' 💼' : '—'}</td>
        <td class="num">${fmtMoney(x.amount)}</td>
        <td class="num"><button class="small danger" onclick="delExpense(${x.id})">✕</button></td></tr>`);
  }

  // ---------- Files ----------
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

  window.uploadFile = run(async () => {
    const companies = await companyOptions();
    openModal('Upload file', [
      { name: 'file', label: 'Choose a file (up to 10 MB)', type: 'file', required: true },
      { name: 'company_id', label: 'Belongs to client (optional)', type: 'select', options: companies },
    ], async (v) => {
      const input = document.querySelector('.modal input[name=file]');
      const f = input.files[0];
      if (!f) throw new Error('Pick a file first');
      if (f.size > 10 * 1024 * 1024) throw new Error('File is larger than the 10 MB limit');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(f);
      });
      await api('POST', '/files', { name: f.name, mime: f.type || 'application/octet-stream', data, company_id: v.company_id || null });
      toast('File uploaded');
      route();
    }, 'Upload');
  });

  window.downloadFile = run(async (id, name) => {
    const res = await fetch(`/api/files/${id}/download`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Could not download the file');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  });

  window.delFile = run(async (id) => { if (confirm('Delete this file?')) { await api('DELETE', `/files/${id}`); route(); } });

  async function showFiles() {
    const rows = await api('GET', '/files');
    view().innerHTML = pageHead('Files', `<button onclick="uploadFile()">+ Upload file</button>`) +
      `<p style="color:var(--muted);margin-top:-8px">Contracts, receipts, briefs — stored inside the CRM database, included in every backup.</p>` +
      table(['File', 'Client', 'Size', 'Uploaded', '', ''], rows, (f) => `<tr>
        <td><strong>${esc(f.name)}</strong></td><td>${esc(f.company_name || '—')}</td>
        <td>${fmtSize(f.size)}</td><td>${fmtDate(f.created_at)} by ${esc(f.uploaded_by_name || '—')}</td>
        <td><a href="#" onclick="downloadFile(${f.id}, '${esc(f.name)}'); return false;">Download</a></td>
        <td class="num"><button class="small danger" onclick="delFile(${f.id})">✕</button></td></tr>`);
  }

  // ---------- Tasks ----------
  window.newTask = run(async () => openModal('New task', [
    { name: 'title', label: 'Task', required: true },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'].map((p) => ({ value: p, label: p })), value: 'medium' },
    { name: 'description', label: 'Details', type: 'textarea' },
  ], async (v) => { await api('POST', '/tasks', v); toast('Task created'); route(); }));
  window.taskStatus = run(async (id, status) => { await api('PATCH', `/tasks/${id}`, { status }); route(); });
  window.delTask = run(async (id) => { await api('DELETE', `/tasks/${id}`); route(); });

  async function showTasks() {
    const rows = await api('GET', '/tasks');
    view().innerHTML = pageHead('Tasks', `<button onclick="newTask()">+ New task</button>`) +
      table(['Task', 'Due', 'Priority', 'Assignee', 'Status', ''], rows, (t) => `<tr>
        <td><strong>${esc(t.title)}</strong>${t.description ? `<br><small>${esc(t.description)}</small>` : ''}</td>
        <td>${fmtDate(t.due_date)}</td><td>${badge(t.priority)}</td><td>${esc(t.assignee_name || '—')}</td>
        <td><select onchange="taskStatus(${t.id}, this.value)">${['todo', 'in_progress', 'done', 'cancelled'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></td>
        <td class="num"><button class="small danger" onclick="delTask(${t.id})">✕</button></td></tr>`);
  }

  // ---------- Reports ----------
  function productivitySection(p) {
    const rate = p.completion_rate_percent;
    const rateColor = rate == null ? 'var(--muted)' : rate < 50 ? 'var(--red)' : rate < 80 ? 'var(--amber)' : 'var(--green)';
    const last14 = p.daily_activity.slice(-14);
    const maxCount = Math.max(1, ...last14.map((d) => d.count));
    return `<div class="panel"><h3>Productivity — am I following through?</h3>
      <div class="cards">
        <div class="stat"><div class="label">Task completion rate (30d)</div><div class="value" style="color:${rateColor}">${rate == null ? '—' : rate + '%'}</div><div class="sub">${p.tasks_done_30d} of ${p.tasks_created_30d} tasks done</div></div>
        <div class="stat ${p.tasks_overdue > 0 ? 'bad' : ''}"><div class="label">Tasks overdue</div><div class="value">${p.tasks_overdue}</div><div class="sub"><a href="#/tasks">view tasks</a></div></div>
        <div class="stat"><div class="label">Avg. hours to first contact</div><div class="value">${p.avg_hours_to_first_contact == null ? '—' : p.avg_hours_to_first_contact}</div><div class="sub">leads contacted/converted, last 30d</div></div>
        <div class="stat"><div class="label">Current streak</div><div class="value">${p.streak_days}</div><div class="sub">consecutive active day${p.streak_days === 1 ? '' : 's'}</div></div>
      </div>
      <h4 style="color:var(--navy);font-size:13px;margin:14px 0 8px">Last 14 days of activity</h4>
      ${last14.map((d) => `<div class="bar-row"><div class="bar-date">${d.date.slice(5)}</div><div class="bar-track"><div class="bar-fill" style="width:${(d.count / maxCount) * 100}%"></div></div><div class="bar-count">${d.count}</div></div>`).join('')}
    </div>`;
  }

  async function showReports() {
    const [pl, sales, clients, productivity] = await Promise.all([
      api('GET', '/reports/profit-loss'), api('GET', '/reports/sales'), api('GET', '/reports/clients'),
      api('GET', '/reports/productivity'),
    ]);
    view().innerHTML = pageHead('Reports') + productivitySection(productivity) + `
      <div class="panel"><h3>Profit &amp; Loss by month</h3>
        ${pl.months.length ? `<table class="grid"><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Profit</th></tr></thead>
          <tbody>${pl.months.map((m) => `<tr><td>${m.month}</td><td class="num">${fmtMoney(m.revenue)}</td><td class="num">${fmtMoney(m.expenses)}</td><td class="num" style="color:${m.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(m.profit)}</td></tr>`).join('')}
          <tr><td><strong>Total</strong></td><td class="num"><strong>${fmtMoney(pl.totals.revenue)}</strong></td><td class="num"><strong>${fmtMoney(pl.totals.expenses)}</strong></td><td class="num"><strong>${fmtMoney(pl.totals.profit)}</strong></td></tr></tbody></table>` : '<div class="empty">No transactions yet.</div>'}
      </div>
      <div class="panel"><h3>Sales funnel</h3>
        <table class="grid"><thead><tr><th>Stage</th><th class="num">Open deals</th><th class="num">Value</th></tr></thead>
        <tbody>${sales.pipeline_by_stage.map((s) => `<tr><td>${esc(s.stage)}</td><td class="num">${s.deals}</td><td class="num">${fmtMoney(s.value)}</td></tr>`).join('')}</tbody></table>
        <p>Won: <strong>${sales.won.count}</strong> (${fmtMoney(sales.won.value)}) · Lost: <strong>${sales.lost.count}</strong> (${fmtMoney(sales.lost.value)}) · Win rate: <strong>${sales.win_rate_percent ?? '—'}${sales.win_rate_percent != null ? '%' : ''}</strong></p>
      </div>
      <div class="panel"><h3>Clients</h3>
        ${clients.length ? `<table class="grid"><thead><tr><th>Client</th><th class="num">Invoices</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Outstanding</th></tr></thead>
        <tbody>${clients.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.invoices}</td><td class="num">${fmtMoney(c.billed)}</td><td class="num">${fmtMoney(c.paid)}</td><td class="num">${fmtMoney(c.outstanding)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No clients yet.</div>'}
      </div>`;
  }

  // ---------- Growth (goals, habits, journal) ----------
  const AREA_LABELS = { business: 'Business', health: 'Health', finance: 'Finance', relationships: 'Relationships', growth: 'Growth', other: 'Other' };
  const areaOptions = () => Object.entries(AREA_LABELS).map(([value, label]) => ({ value, label }));
  const areaBadge = (area) => `<span class="badge area-${esc(area)}">${esc(AREA_LABELS[area] || area)}</span>`;
  let journalEntryId = null; // set from GET /journal/today — decides Save = PATCH vs POST

  window.newGoal = run(async () => openModal('New goal', [
    { name: 'title', label: 'Goal', required: true },
    { name: 'area', label: 'Area', type: 'select', value: 'other', options: areaOptions() },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'target_date', label: 'Target date', type: 'date' },
    { name: 'target_value', label: 'Target value (optional, e.g. 12 for "read 12 books")', type: 'number', step: 'any' },
    { name: 'unit', label: 'Unit (optional, e.g. books, lbs, dollars)' },
  ], async (v) => { await api('POST', '/goals', v); toast('Goal set — go get it'); route(); }));

  window.newHabit = run(async () => openModal('New habit', [
    { name: 'title', label: 'Habit', required: true },
    { name: 'area', label: 'Area', type: 'select', value: 'other', options: areaOptions() },
    { name: 'frequency', label: 'Frequency', type: 'select', value: 'daily', options: [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }] },
  ], async (v) => { await api('POST', '/habits', v); toast('Habit added'); route(); }));

  window.toggleHabit = run(async (id, checkedToday) => {
    if (checkedToday) await api('DELETE', `/habits/${id}/checkin`);
    else await api('POST', `/habits/${id}/checkin`, {});
    route();
  });

  window.logGoalProgress = run(async (id, current, unit) => {
    const v = prompt(`New current value${unit ? ` (${unit})` : ''}:`, current ?? 0);
    if (v === null || v.trim() === '') return;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Enter a number');
    await api('PATCH', `/goals/${id}`, { current_value: n });
    toast('Progress logged');
    route();
  });

  window.goalStatus = run(async (id, status) => { await api('PATCH', `/goals/${id}`, { status }); toast(status === 'done' ? 'Goal completed 🎉' : 'Goal abandoned'); route(); });
  window.delGoal = run(async (id) => { if (confirm('Delete this goal?')) { await api('DELETE', `/goals/${id}`); route(); } });

  window.saveJournal = run(async () => {
    const content = document.getElementById('journalContent').value.trim();
    if (!content) throw new Error('Write something first');
    const moodInput = document.querySelector('input[name=mood]:checked');
    const mood = moodInput ? moodInput.value : null;
    if (journalEntryId) await api('PATCH', `/journal/${journalEntryId}`, { content, mood });
    else { const entry = await api('POST', '/journal', { content, mood }); journalEntryId = entry.id; }
    toast('Journal entry saved');
    route();
  });

  function habitCard(h) {
    const unit = h.frequency === 'weekly' ? 'week' : 'day';
    return `<div class="habit-card ${h.checked_today ? 'checked' : ''}">
      <div class="habit-title">${esc(h.title)}</div>
      <div class="habit-area">${areaBadge(h.area)}</div>
      <button type="button" class="habit-check" onclick="toggleHabit(${h.id}, ${h.checked_today ? 'true' : 'false'})">${h.checked_today ? '✓ Done' : '✓ Done today'}</button>
      <div class="habit-streak">${h.streak > 0 ? `🔥 ${h.streak} ${unit}${h.streak === 1 ? '' : 's'} streak` : 'Start your streak'}</div>
    </div>`;
  }

  function goalCard(g) {
    const hasTarget = g.target_value != null && Number(g.target_value) > 0;
    const pct = hasTarget ? Math.max(0, Math.min(100, Math.round(((g.current_value || 0) / g.target_value) * 100))) : null;
    return `<div class="goal-card">
      <div class="goal-head"><div class="goal-title">${esc(g.title)}</div>${areaBadge(g.area)}</div>
      ${g.description ? `<div class="goal-desc">${esc(g.description)}</div>` : ''}
      ${hasTarget ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="goal-progress-label">${g.current_value || 0} / ${g.target_value} ${esc(g.unit || '')} · ${pct}%</div>` : ''}
      ${g.target_date ? `<div class="goal-date">Target: ${fmtDate(g.target_date)}</div>` : ''}
      <div class="goal-actions">
        ${g.status === 'active' ? `
          <button type="button" class="small" onclick="logGoalProgress(${g.id}, ${g.current_value || 0}, '${esc(g.unit || '')}')">+ Progress</button>
          <button type="button" class="small" onclick="goalStatus(${g.id}, 'done')">Mark done</button>
          <button type="button" class="small secondary" onclick="goalStatus(${g.id}, 'abandoned')">Abandon</button>`
          : badge(g.status)}
        <button type="button" class="small danger" onclick="delGoal(${g.id})">✕</button>
      </div>
    </div>`;
  }

  const MOODS = [['great', '😄 Great'], ['good', '🙂 Good'], ['okay', '😐 Okay'], ['rough', '😕 Rough'], ['bad', '😣 Bad']];

  async function showGrowth() {
    const [habits, goals, todayEntry, recentEntries] = await Promise.all([
      api('GET', '/habits?active=true'), api('GET', '/goals'), api('GET', '/journal/today'), api('GET', '/journal?limit=10'),
    ]);
    journalEntryId = todayEntry ? todayEntry.id : null;
    const activeGoals = goals.filter((g) => g.status === 'active');
    const otherGoals = goals.filter((g) => g.status !== 'active');

    view().innerHTML = pageHead('Growth', `<button class="secondary" onclick="newHabit()">+ New habit</button> <button onclick="newGoal()">+ New goal</button>`) + `
      <div class="panel"><h3>Today's check-in</h3>
        <p style="color:var(--muted);margin-top:-8px">Same honest-mirror idea as the Productivity report — but for the whole person, not just business tasks.</p>
        ${habits.length ? `<div class="habit-grid">${habits.map(habitCard).join('')}</div>` : '<div class="empty">No habits yet — add one to start building a streak.</div>'}
      </div>
      <div class="panel"><h3>Goals</h3>
        ${activeGoals.length ? `<div class="goal-grid">${activeGoals.map(goalCard).join('')}</div>` : '<div class="empty">No active goals — set one to work toward, business or personal.</div>'}
        ${otherGoals.length ? `<h4 style="color:var(--navy);font-size:13px;margin:16px 0 8px">Done &amp; abandoned</h4><div class="goal-grid">${otherGoals.map(goalCard).join('')}</div>` : ''}
      </div>
      <div class="panel"><h3>Journal</h3>
        <textarea id="journalContent" rows="5" placeholder="What's worth remembering today?">${esc(todayEntry?.content || '')}</textarea>
        <div class="mood-picker">${MOODS.map(([v, label]) => `<label><input type="radio" name="mood" value="${v}" ${todayEntry?.mood === v ? 'checked' : ''}> ${label}</label>`).join('')}</div>
        <button onclick="saveJournal()">Save today's entry</button>
        <h4 style="color:var(--navy);font-size:13px;margin:18px 0 8px">Recent entries</h4>
        ${recentEntries.length ? recentEntries.map((e) => `<div class="journal-entry"><strong>${fmtDate(e.entry_date)}</strong>${e.mood ? ' · ' + esc(e.mood) : ''}<br><span class="journal-excerpt">${esc((e.content || '').slice(0, 140))}${(e.content || '').length > 140 ? '…' : ''}</span></div>`).join('') : '<div class="empty">No entries yet.</div>'}
      </div>`;
  }

  // ---------- Team (admin user management) ----------
  window.newUser = run(async () => openModal('Add team member', [
    { name: 'name', label: 'Name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'password', label: 'Temporary password (min 8 characters)', required: true },
    { name: 'role', label: 'Role', type: 'select', value: 'staff', options: [
      { value: 'staff', label: 'Staff — everything except settings & team' },
      { value: 'admin', label: 'Admin — full access' }] },
  ], async (v) => { await api('POST', '/auth/users', v); toast('Team member added'); route(); }, 'Add'));

  window.toggleUser = run(async (id, activate) => {
    await api('PATCH', `/auth/users/${id}`, { is_active: activate });
    toast(activate ? 'Account re-activated' : 'Account deactivated');
    route();
  });

  window.resetPassword = run(async (id, name) => openModal(`Reset password for ${name}`, [
    { name: 'password', label: 'New password (min 8 characters)', required: true },
  ], async (v) => { await api('PATCH', `/auth/users/${id}`, v); toast('Password updated'); }, 'Reset'));

  function teamPanel(users) {
    if (!users) return '';
    return `<div class="panel"><h3>Team</h3>
      <table class="grid"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${badge(u.role)}</td>
        <td><span class="badge ${u.is_active ? 'accepted' : 'cancelled'}">${u.is_active ? 'active' : 'inactive'}</span></td>
        <td class="num">
          <button class="small" onclick="resetPassword(${u.id}, '${esc(u.name)}')">Reset password</button>
          ${u.id !== me.id ? `<button class="small ${u.is_active ? 'danger' : ''}" onclick="toggleUser(${u.id}, ${u.is_active ? 'false' : 'true'})">${u.is_active ? 'Deactivate' : 'Re-activate'}</button>` : ''}
        </td></tr>`).join('')}</tbody></table>
      <p style="margin-bottom:0"><button onclick="newUser()">+ Add team member</button></p>
    </div>`;
  }

  // ---------- Notifications (Web Push) ----------
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window;

  async function getPushSubscription() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  function notificationsPanel(enabled, denied) {
    if (!pushSupported()) {
      return `<div class="panel"><h3>Notifications</h3><p class="empty">Push notifications aren't supported in this browser — try a recent Chrome, Edge, Firefox or Safari.</p></div>`;
    }
    return `<div class="panel"><h3>Notifications</h3>
      <p style="color:var(--muted);margin-top:-8px">Get a push alert on this device for new leads, tasks due soon or overdue, and invoices that go overdue.</p>
      ${denied ? '<p class="empty">Notifications are blocked for this site in your browser/OS settings — allow them there, then reload this page.</p>' : ''}
      <button data-push-toggle ${denied ? 'disabled' : ''}>${enabled ? 'Notifications enabled ✓ — Disable' : 'Enable push notifications on this device'}</button>
    </div>`;
  }

  window.togglePush = run(async () => {
    if (!pushSupported()) throw new Error('Push notifications are not supported in this browser');
    const existing = await getPushSubscription();
    if (existing) {
      try { await api('DELETE', '/push/subscribe', { endpoint: existing.endpoint }); } catch { /* already gone server-side */ }
      await existing.unsubscribe();
      toast('Notifications disabled on this device');
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { toast('Notification permission was not granted', true); route(); return; }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api('GET', '/push/vapid-public-key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api('POST', '/push/subscribe', sub.toJSON());
      toast('Notifications enabled on this device');
    }
    route();
  });

  // ---------- Settings ----------
  async function showSettings() {
    settings = await api('GET', '/settings');
    let users = null;
    if (me.role === 'admin') {
      try { users = await api('GET', '/auth/users'); } catch { /* older backend without team API */ }
    }
    const keys = [
      ['company_name', 'Company name'], ['company_email', 'Company email'], ['company_phone', 'Phone'],
      ['company_website', 'Website'], ['company_address', 'Address'], ['currency', 'Currency code'],
      ['currency_symbol', 'Currency symbol'], ['default_tax_rate', 'Default tax rate %'],
      ['invoice_prefix', 'Invoice prefix'], ['proposal_prefix', 'Proposal prefix'],
      ['invoice_due_days', 'Invoice due (days)'], ['proposal_valid_days', 'Proposal valid (days)'],
      ['invoice_terms', 'Invoice terms'], ['proposal_terms', 'Proposal terms'],
    ];
    const pushSub = await getPushSubscription().catch(() => null);
    const pushDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
    view().innerHTML = pageHead('Settings') + `<div class="panel"><form id="settingsForm">
      <div class="modal" style="box-shadow:none;padding:0;width:auto;max-width:640px">
        ${keys.map(([k, label]) => `<div class="field"><label>${label}</label><input name="${k}" value="${esc(settings[k] ?? '')}" ${me.role !== 'admin' ? 'disabled' : ''}></div>`).join('')}
      </div>
      ${me.role === 'admin' ? '<button type="submit">Save settings</button>' : '<p class="empty">Only admins can edit settings.</p>'}
    </form></div>` + notificationsPanel(!!pushSub, pushDenied) + teamPanel(users);
    if (me.role === 'admin') {
      document.getElementById('settingsForm').onsubmit = run(async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(keys.map(([k]) => [k, e.target.elements[k].value]));
        settings = await api('PUT', '/settings', body);
        toast('Settings saved');
      });
    }
    const pushBtn = document.querySelector('[data-push-toggle]');
    if (pushBtn) pushBtn.onclick = window.togglePush;
  }

  // ---------- router ----------
  const ROUTES = {
    dashboard: showDashboard, leads: showLeads, pipeline: showPipeline, contacts: showContacts,
    companies: showCompanies, services: showServices, proposals: showProposals, invoices: showInvoices,
    expenses: showExpenses, files: showFiles, tasks: showTasks, reports: showReports, growth: showGrowth,
    settings: showSettings,
  };

  const route = run(async () => {
    const name = (location.hash || '#/dashboard').replace('#/', '').split('?')[0];
    const fn = ROUTES[name] || showDashboard;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
    view().innerHTML = '<div class="empty">Loading…</div>';
    await fn();
  });

  window.addEventListener('hashchange', route);

  // ---------- boot ----------
  async function boot() {
    if (!token) return renderLogin(false);
    try {
      me = (await api('GET', '/auth/me')).user;
      settings = await api('GET', '/settings');
    } catch {
      return logout();
    }
    renderShell();
    route();
  }

  registerServiceWorker();
  boot();
})();
