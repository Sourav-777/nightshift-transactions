const $ = (sel) => document.querySelector(sel);

let META = null;
let knownIds = new Set();

async function loadMeta() {
  const res = await fetch('/api/meta');
  META = await res.json();

  fillSelect('#f_store', META.stores.map(s => ({ value: s.store_location, label: `${s.store_location} — ${s.city}` })));
  fillSelect('#f_barista', META.baristas.map(b => ({ value: b, label: b })));
  fillSelect('#f_product', META.products.map(p => ({ value: p.product_name, label: `${p.product_name} · $${p.unit_price.toFixed(2)}` })));
  fillSelect('#f_payment', META.paymentMethods.map(p => ({ value: p, label: p })));
  fillSelect('#f_channel', META.orderChannels.map(c => ({ value: c, label: c })));

  syncUnitPrice();
}

function fillSelect(selector, items) {
  const el = $(selector);
  el.innerHTML = '';
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    el.appendChild(opt);
  }
}

function syncUnitPrice() {
  const productName = $('#f_product').value;
  const product = META.products.find(p => p.product_name === productName);
  if (product) $('#f_price').value = product.unit_price.toFixed(2);
}

async function setHealthPill(id, ok, label) {
  const el = $(id);
  el.classList.remove('ok', 'bad');
  el.classList.add(ok ? 'ok' : 'bad');
  el.firstChild.textContent = label + ' ';
}

async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const h = await res.json();
    setHealthPill('#pill-mysql', h.mysql === 'ok', 'MySQL');
    setHealthPill('#pill-snowflake', h.snowflake === 'ok', 'Snowflake');
  } catch (e) {
    setHealthPill('#pill-mysql', false, 'MySQL');
    setHealthPill('#pill-snowflake', false, 'Snowflake');
  }
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

async function refreshStats() {
  try {
    const res = await fetch('/api/stats/today');
    const s = await res.json();
    $('#statOrders').textContent = s.order_count;
    $('#statGross').textContent = money(s.gross_sales);
    $('#statRefunded').textContent = money(s.refunded);
    $('#statSynced').textContent = new Date().toLocaleTimeString();
  } catch (e) {
    // silent — health pills already show DB status
  }
}

function ticketHTML(tx, isFresh) {
  const time = new Date(tx.transaction_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="ticket ${isFresh ? 'fresh' : ''}" data-id="${tx.transaction_id}">
      <div class="ticket-top">
        <span class="ticket-store">${tx.store_location}</span>
        <span class="ticket-id">#${tx.transaction_id.slice(0, 8)}</span>
      </div>
      <div class="ticket-line"><span>${tx.quantity} × ${tx.product_name}</span><span>${money(tx.unit_price)}</span></div>
      <div class="ticket-line muted"><span>${tx.barista_name} · ${tx.order_channel}</span><span>${time}</span></div>
      <div class="ticket-line muted"><span>${tx.customer_name || 'Walk-in'}</span><span>${tx.payment_method}</span></div>
      <div class="ticket-total"><span>Total</span><span>${money(tx.total_amount)}</span></div>
      <div class="ticket-bottom">
        <span class="status-badge ${tx.status}">${tx.status}</span>
        <span class="ticket-actions">
          <select data-id="${tx.transaction_id}" class="status-select">
            <option value="Completed" ${tx.status === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Pending" ${tx.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Refunded" ${tx.status === 'Refunded' ? 'selected' : ''}>Refunded</option>
            <option value="Voided" ${tx.status === 'Voided' ? 'selected' : ''}>Voided</option>
          </select>
        </span>
      </div>
    </div>
  `;
}

async function refreshFeed() {
  try {
    const res = await fetch('/api/transactions?limit=50');
    const rows = await res.json();

    const feed = $('#ticketFeed');
    if (rows.length === 0) {
      feed.innerHTML = '<p class="empty-state">No tickets yet tonight. Ring one in.</p>';
      return;
    }

    feed.innerHTML = rows.map(tx => ticketHTML(tx, !knownIds.has(tx.transaction_id))).join('');
    knownIds = new Set(rows.map(r => r.transaction_id));

    document.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', onStatusChange);
    });
  } catch (e) {
    console.error('feed refresh failed', e);
  }
}

async function onStatusChange(e) {
  const id = e.target.getAttribute('data-id');
  const status = e.target.value;
  e.target.disabled = true;
  try {
    await fetch(`/api/transactions/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await refreshFeed();
    await refreshStats();
  } catch (err) {
    console.error(err);
  } finally {
    e.target.disabled = false;
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const btn = $('#submitBtn');
  const note = $('#formNote');
  btn.disabled = true;
  note.textContent = 'Sending to MySQL + Snowflake…';
  note.classList.remove('error');

  const payload = {
    store_location: $('#f_store').value,
    city: (META.stores.find(s => s.store_location === $('#f_store').value) || {}).city,
    barista_name: $('#f_barista').value,
    customer_name: $('#f_customer').value.trim() || null,
    product_name: $('#f_product').value,
    quantity: Number($('#f_qty').value) || 1,
    unit_price: Number($('#f_price').value),
    payment_method: $('#f_payment').value,
    order_channel: $('#f_channel').value,
  };

  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to save transaction');

    const r = data.results;
    note.textContent = `Saved · MySQL: ${r.mysql} · Snowflake: ${r.snowflake} · Power BI: ${r.powerbi}`;

    $('#f_customer').value = '';
    $('#f_qty').value = 1;

    await refreshFeed();
    await refreshStats();
  } catch (err) {
    note.textContent = `Error: ${err.message}`;
    note.classList.add('error');
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  await loadMeta();
  $('#f_product').addEventListener('change', syncUnitPrice);
  $('#orderForm').addEventListener('submit', onSubmit);

  await Promise.all([refreshHealth(), refreshFeed(), refreshStats()]);

  // Poll so the feed / stats / health feel live even without a manual submit
  // (e.g. if you insert rows from another tool, or run seed.js).
  setInterval(refreshFeed, 4000);
  setInterval(refreshStats, 5000);
  setInterval(refreshHealth, 10000);
}

init();
