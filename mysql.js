const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

async function insertTransaction(tx) {
  const sql = `
    INSERT INTO transactions
      (transaction_id, store_location, city, barista_name, customer_name,
       product_name, category, quantity, unit_price, total_amount,
       payment_method, order_channel, status, transaction_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    tx.transaction_id, tx.store_location, tx.city, tx.barista_name, tx.customer_name,
    tx.product_name, tx.category, tx.quantity, tx.unit_price, tx.total_amount,
    tx.payment_method, tx.order_channel, tx.status, tx.transaction_time,
  ];
  await pool.execute(sql, params);
}

async function updateTransactionStatus(transaction_id, status) {
  await pool.execute(
    `UPDATE transactions SET status = ? WHERE transaction_id = ?`,
    [status, transaction_id]
  );
}

async function listRecentTransactions(limit = 50) {
  const [rows] = await pool.query(
    `SELECT * FROM transactions ORDER BY transaction_time DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

async function getTodayStats() {
  const [rows] = await pool.query(`
    SELECT
      COUNT(*)                                            AS order_count,
      COALESCE(SUM(CASE WHEN status = 'Completed' THEN total_amount ELSE 0 END), 0) AS gross_sales,
      COALESCE(SUM(CASE WHEN status = 'Refunded'  THEN total_amount ELSE 0 END), 0) AS refunded
    FROM transactions
    WHERE DATE(transaction_time) = CURDATE()
  `);
  return rows[0];
}

async function ping() {
  await pool.query('SELECT 1');
}

module.exports = {
  pool,
  insertTransaction,
  updateTransactionStatus,
  listRecentTransactions,
  getTodayStats,
  ping,
};
