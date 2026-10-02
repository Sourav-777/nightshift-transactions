// Backfills ~2 weeks of realistic historical transactions into MySQL and
// Snowflake, so your Power BI report has something to chart before you start
// ringing in live orders. Safe to run once after creating the schemas.
//
//   node seed.js            -> 700 historical rows
//   node seed.js 2000       -> 2000 historical rows

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const mysqlDb = require('./db/mysql');
const snowflakeDb = require('./db/snowflake');

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
const PAYMENT_METHODS = ['Card', 'Card', 'Card', 'Mobile Wallet', 'Cash', 'Gift Card'];
const ORDER_CHANNELS = ['Counter', 'Counter', 'Drive-Thru', 'Mobile App', 'Kiosk'];
const STATUSES = ['Completed', 'Completed', 'Completed', 'Completed', 'Completed', 'Refunded', 'Voided'];
const NAMES = ['Alex', 'Jordan', 'Sam', 'Priya', 'Diego', 'Wei', 'Fatima', 'Noah', 'Ola', null, null];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function randomTransactionTime(daysAgoMax) {
  const daysAgo = Math.random() * daysAgoMax;
  const d = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
  // Weight toward morning / afternoon coffee rushes
  const hourBuckets = [7, 8, 8, 9, 9, 12, 13, 15, 16, 17];
  d.setHours(pick(hourBuckets), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
  return d;
}

function buildRow() {
  const store = pick(STORES);
  const product = pick(PRODUCTS);
  const quantity = pick([1, 1, 1, 2, 2, 3]);
  const unit_price = product.unit_price;
  return {
    transaction_id: uuidv4(),
    store_location: store.store_location,
    city: store.city,
    barista_name: pick(BARISTAS),
    customer_name: pick(NAMES),
    product_name: product.product_name,
    category: product.category,
    quantity,
    unit_price,
    total_amount: Number((unit_price * quantity).toFixed(2)),
    payment_method: pick(PAYMENT_METHODS),
    order_channel: pick(ORDER_CHANNELS),
    status: pick(STATUSES),
    transaction_time: randomTransactionTime(14),
  };
}

async function run() {
  const count = Number(process.argv[2]) || 700;
  console.log(`Seeding ${count} historical transactions into MySQL + Snowflake...`);

  let ok = 0, failMysql = 0, failSnowflake = 0;
  for (let i = 0; i < count; i++) {
    const row = buildRow();
    try {
      await mysqlDb.insertTransaction(row);
    } catch (e) {
      failMysql++;
    }
    try {
      await snowflakeDb.insertTransaction(row);
    } catch (e) {
      failSnowflake++;
    }
    ok++;
    if (ok % 100 === 0) console.log(`  ...${ok}/${count}`);
  }

  console.log(`Done. ${ok} rows attempted. MySQL failures: ${failMysql}. Snowflake failures: ${failSnowflake}.`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
