// Pushes a single transaction row to a Power BI "Streaming dataset" (API type)
// so a report tile can update within a second or two of a new order coming in.
//
// Setup (one-time, in the Power BI service — app.powerbi.com):
//   1. Open a workspace -> "+ New" -> "Streaming dataset".
//   2. Choose "API", name it e.g. "Nightshift Live Transactions".
//   3. Add these fields with these exact names/types (matches the payload below):
//        transaction_id     Text
//        store_location     Text
//        city               Text
//        barista_name       Text
//        customer_name      Text
//        product_name       Text
//        category           Text
//        quantity           Number
//        unit_price         Number
//        total_amount       Number
//        payment_method     Text
//        order_channel      Text
//        status             Text
//        transaction_time   DateTime
//   4. Turn ON "Historic data analysis" if you want to build visuals against
//      it directly (otherwise it's tile-only, last value shown).
//   5. Copy the "Push URL" it gives you into POWERBI_PUSH_URL in your .env.
//
// If POWERBI_PUSH_URL is left blank, this simply no-ops — MySQL/Snowflake
// writes still happen normally.

const fetch = require('node-fetch');

async function pushToPowerBI(tx) {
  const url = process.env.POWERBI_PUSH_URL;
  if (!url) return { skipped: true };

  const payload = [
    {
      transaction_id: tx.transaction_id,
      store_location: tx.store_location,
      city: tx.city,
      barista_name: tx.barista_name,
      customer_name: tx.customer_name || '',
      product_name: tx.product_name,
      category: tx.category,
      quantity: tx.quantity,
      unit_price: tx.unit_price,
      total_amount: tx.total_amount,
      payment_method: tx.payment_method,
      order_channel: tx.order_channel,
      status: tx.status,
      transaction_time: new Date(tx.transaction_time).toISOString(),
    },
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Power BI push failed (${res.status}): ${text}`);
  }
  return { skipped: false };
}

module.exports = { pushToPowerBI };
