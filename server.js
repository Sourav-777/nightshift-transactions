require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const mysqlDb = require('./db/mysql');
const snowflakeDb = require('./db/snowflake');
const { pushToPowerBI } = require('./powerbi/pushDataset');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Reference data used to generate/validate orders ----------------------
const STORES = [
  { store_location: 'Downtown Loop', city: 'Chicago' },
  { store_location: 'Riverside Pier', city: 'Portland' },
  { store_location: 'Airport Terminal B', city: 'Denver' },
  { store_location: 'Old Town Square', city: 'Austin' },
  { store_location: 'Harbor Front', city: 'Seattle' },
];
const BARISTAS = ['Maya R.', 'Deshawn P.', 'Ines K.', 'Theo M.', 'Priya S.', 'Colin B.'];
const PRODUCTS = [
  { product_name: 'Midnight Espresso', category: 'Espresso', unit_price: 3.75 },
  { product_name: 'Oat Milk Cortado', category: 'Espresso', unit_price: 4.5 },
  { product_name: 'Nitro Cold Brew', category: 'Cold Brew', unit_price: 5.25 },
  { product_name: 'Vanilla Cold Foam Brew', category: 'Cold Brew', unit_price: 5.75 },
  { product_name: 'Almond Croissant', category: 'Pastry', unit_price: 4.25 },
  { product_name: 'Dark Chocolate Scone', category: 'Pastry', unit_price: 3.95 },
  { product_name: 'Ethiopia Yirgacheffe Beans (12oz)', category: 'Beans', unit_price: 16.0 },
  { product_name: 'Nightshift Ceramic Mug', category: 'Merch', unit_price: 18.0 },
];
const PAYMENT_METHODS = ['Card', 'Cash', 'Mobile Wallet', 'Gift Card'];
const ORDER_CHANNELS = ['Counter', 'Drive-Thru', 'Mobile App', 'Kiosk'];

app.get('/api/meta', (req, res) => {
  res.json({ stores: STORES, baristas: BARISTAS, products: PRODUCTS, paymentMethods: PAYMENT_METHODS, orderChannels: ORDER_CHANNELS });
});

// ---- Health check: confirms both databases are reachable -------------------
app.get('/api/health', async (req, res) => {
  const health = { mysql: 'unknown', snowflake: 'unknown' };
  try {
    await mysqlDb.ping();
    health.mysql = 'ok';
  } catch (e) {
    health.mysql = `error: ${e.message}`;
  }
  try {
    await snowflakeDb.ping();
    health.snowflake = 'ok';
  } catch (e) {
    health.snowflake = `error: ${e.message}`;
  }
  res.json(health);
});

// ---- List recent transactions (read from MySQL) -----------------------------
app.get('/api/transactions', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const rows = await mysqlDb.listRecentTransactions(limit);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats/today', async (req, res) => {
  try {
    const stats = await mysqlDb.getTodayStats();
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Create a transaction: writes to MySQL + Snowflake, pushes to Power BI --
app.post('/api/transactions', async (req, res) => {
  try {
    const body = req.body || {};

    const product = PRODUCTS.find((p) => p.product_name === body.product_name) || PRODUCTS[0];
    const quantity = Math.max(1, Number(body.quantity) || 1);
    const unit_price = Number(body.unit_price) || product.unit_price;

    const tx = {
      transaction_id: uuidv4(),
      store_location: body.store_location || STORES[0].store_location,
      city: body.city || STORES[0].city,
      barista_name: body.barista_name || BARISTAS[0],
      customer_name: body.customer_name || null,
      product_name: product.product_name,
      category: body.category || product.category,
      quantity,
      unit_price,
      total_amount: Number((unit_price * quantity).toFixed(2)),
      payment_method: body.payment_method || PAYMENT_METHODS[0],
      order_channel: body.order_channel || ORDER_CHANNELS[0],
      status: body.status || 'Completed',
      transaction_time: body.transaction_time || new Date(),
    };

    const results = { mysql: 'pending', snowflake: 'pending', powerbi: 'pending' };

    try {
      await mysqlDb.insertTransaction(tx);
      results.mysql = 'ok';
    } catch (e) {
      results.mysql = `error: ${e.message}`;
    }

    try {
      await snowflakeDb.insertTransaction(tx);
      results.snowflake = 'ok';
    } catch (e) {
      results.snowflake = `error: ${e.message}`;
    }

    try {
      const r = await pushToPowerBI(tx);
      results.powerbi = r.skipped ? 'skipped (no POWERBI_PUSH_URL set)' : 'ok';
    } catch (e) {
      results.powerbi = `error: ${e.message}`;
    }

    res.status(201).json({ transaction: tx, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Update a transaction's status: MySQL + Snowflake + Power BI -----------
app.patch('/api/transactions/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['Completed', 'Refunded', 'Voided', 'Pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const results = { mysql: 'pending', snowflake: 'pending', powerbi: 'pending' };

    try {
      await mysqlDb.updateTransactionStatus(id, status);
      results.mysql = 'ok';
    } catch (e) {
      results.mysql = `error: ${e.message}`;
    }

    try {
      await snowflakeDb.updateTransactionStatus(id, status);
      results.snowflake = 'ok';
    } catch (e) {
      results.snowflake = `error: ${e.message}`;
    }

    // Re-fetch the full row so we can push the updated snapshot to Power BI.
    try {
      const rows = await mysqlDb.listRecentTransactions(500);
      const updated = rows.find((r) => r.transaction_id === id);
      if (updated) {
        const r = await pushToPowerBI(updated);
        results.powerbi = r.skipped ? 'skipped (no POWERBI_PUSH_URL set)' : 'ok';
      } else {
        results.powerbi = 'skipped (row not found for push)';
      }
    } catch (e) {
      results.powerbi = `error: ${e.message}`;
    }

    res.json({ transaction_id: id, status, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3787;
app.listen(PORT, () => {
  console.log(`Nightshift Espresso Co. console running at http://localhost:${PORT}`);
});
