# Nightshift Espresso Co. — Live Order Console

A local website that rings in coffee-shop transactions and writes every one
of them to **MySQL** and **Snowflake** at the same time, then streams it to
**Power BI** in real time. Built as a self-contained example you can adapt to
any "live transactions" dataset.

```
public/         the local website (plain HTML/CSS/JS, no build step)
server.js       Express API: create/update transactions, list feed, health
db/mysql.js     MySQL pool + queries (mysql2)
db/snowflake.js Snowflake connection + queries (snowflake-sdk)
powerbi/        pushes each new/updated row to a Power BI streaming dataset
sql/            schema for both databases
seed.js         optional: backfills ~2 weeks of history so PBI has data to chart
```

## 1. Prerequisites

- Node.js 18+
- A MySQL server you can reach (local install, Docker, or a cloud instance)
- A Snowflake account (the free trial works fine)
- Power BI Desktop, and a Power BI account if you want the real-time push tile

## 2. Set up the databases

**MySQL:**
```bash
mysql -u root -p < sql/mysql_schema.sql
```

**Snowflake:** open a Snowsight worksheet and run `sql/snowflake_schema.sql`
(or `snowsql -f sql/snowflake_schema.sql`).

Both create a `transactions` table plus a `v_transactions` view with the same
shape, so you can point Power BI at either.

## 3. Configure and run the app

```bash
cp .env.example .env      # then fill in your MySQL + Snowflake credentials
npm install
npm start
```

Open **http://localhost:3787**. You'll see connection pills for MySQL and
Snowflake at the top — they turn green once the app can reach both. Ring in
an order from the form on the left; it appears instantly as a receipt-style
ticket in the live feed, and the status dropdown on each ticket lets you mark
it Refunded/Voided/Pending, which updates both databases again.

Optional: `node seed.js 1000` backfills 1,000 historical rows across the
past two weeks into both databases, so your first Power BI visuals have
something interesting to show before you start clicking around live.

## 4. Connect Power BI

You have two complementary options — most people want both: an
import/DirectQuery model for real reports, and the streaming push for a
tile that visibly ticks up the moment an order comes in.

### Option A — Import or DirectQuery (the actual report)

In Power BI Desktop: **Get Data →**

- **MySQL database**: host `127.0.0.1` (or wherever your MySQL runs), the
  database `nightshift`, table `transactions` or `v_transactions`. Requires
  the MySQL Connector/NET (Power BI will prompt you to install it once).
- **Snowflake**: server is your account URL (e.g.
  `abc12345.us-east-1.snowflakecomputing.com`), warehouse `NIGHTSHIFT_WH`,
  then browse to `NIGHTSHIFT.PUBLIC.TRANSACTIONS`.

Choose **DirectQuery** on either if you want visuals to reflect new rows on
every interaction/refresh without re-importing; choose **Import** for faster
visuals with a scheduled refresh instead.

> **Local MySQL + the Power BI service:** Power BI Desktop on your own
> machine can reach `localhost` MySQL directly. But if you **publish** the
> report to the Power BI service and want it to refresh on a schedule there,
> the service is cloud-hosted and can't reach your laptop's MySQL — you'd
> need the **On-premises Data Gateway** installed on a machine that can
> reach it. Snowflake, being cloud-hosted already, doesn't need a gateway.

### Option B — Real-time streaming tile (the "live" part)

This is what makes a number on your dashboard move the instant you ring in
an order, with no refresh button involved.

1. In the Power BI **service** (app.powerbi.com), open a workspace →
   **+ New → Streaming dataset → API**.
2. Name it (e.g. `Nightshift Live Transactions`) and add these fields —
   names and types must match exactly:

   | Field | Type |
   |---|---|
   | transaction_id | Text |
   | store_location | Text |
   | city | Text |
   | barista_name | Text |
   | customer_name | Text |
   | product_name | Text |
   | category | Text |
   | quantity | Number |
   | unit_price | Number |
   | total_amount | Number |
   | payment_method | Text |
   | order_channel | Text |
   | status | Text |
   | transaction_time | DateTime |

3. Turn on **Historic data analysis** if you want to build charts against it
   directly (otherwise it's a "last value" tile only).
4. Copy the **Push URL** it gives you and paste it into `.env` as
   `POWERBI_PUSH_URL`. Restart the app.
5. Ring in an order — the form's confirmation line will say
   `Power BI: ok`, and a tile pinned from this dataset updates within a
   second or two.

## API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | stores, baristas, products, payment methods, channels |
| GET | `/api/health` | connectivity check for MySQL + Snowflake |
| GET | `/api/transactions?limit=50` | recent transactions (from MySQL) |
| GET | `/api/stats/today` | today's order count, gross sales, refunds |
| POST | `/api/transactions` | create — writes MySQL + Snowflake + Power BI |
| PATCH | `/api/transactions/:id/status` | update status — same three targets |

## Adapting this to a different dataset

The "interesting" part is just the domain model. To repurpose this for, say,
ride-share trips or ticket sales: rename the columns in `sql/*.sql`,
`db/*.js`, `server.js`'s reference-data arrays, and the ticket template in
`public/app.js`. The write-to-both-databases-then-push-to-Power-BI pattern
stays identical.
