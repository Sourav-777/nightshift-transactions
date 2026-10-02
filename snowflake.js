const snowflake = require('snowflake-sdk');

const connection = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USERNAME,
  password: process.env.SNOWFLAKE_PASSWORD,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE,
  schema: process.env.SNOWFLAKE_SCHEMA,
  role: process.env.SNOWFLAKE_ROLE,
});

let connected = false;
let connectingPromise = null;

function connect() {
  if (connected) return Promise.resolve();
  if (connectingPromise) return connectingPromise;

  connectingPromise = new Promise((resolve, reject) => {
    connection.connect((err) => {
      if (err) {
        connectingPromise = null;
        return reject(err);
      }
      connected = true;
      resolve();
    });
  });
  return connectingPromise;
}

function execute(sqlText, binds = []) {
  return connect().then(
    () =>
      new Promise((resolve, reject) => {
        connection.execute({
          sqlText,
          binds,
          complete: (err, stmt, rows) => {
            if (err) return reject(err);
            resolve(rows);
          },
        });
      })
  );
}

async function insertTransaction(tx) {
  const sql = `
    INSERT INTO TRANSACTIONS
      (TRANSACTION_ID, STORE_LOCATION, CITY, BARISTA_NAME, CUSTOMER_NAME,
       PRODUCT_NAME, CATEGORY, QUANTITY, UNIT_PRICE, TOTAL_AMOUNT,
       PAYMENT_METHOD, ORDER_CHANNEL, STATUS, TRANSACTION_TIME)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const binds = [
    tx.transaction_id, tx.store_location, tx.city, tx.barista_name, tx.customer_name,
    tx.product_name, tx.category, tx.quantity, tx.unit_price, tx.total_amount,
    tx.payment_method, tx.order_channel, tx.status, tx.transaction_time,
  ];
  await execute(sql, binds);
}

async function updateTransactionStatus(transaction_id, status) {
  await execute(
    `UPDATE TRANSACTIONS SET STATUS = ?, UPDATED_AT = CURRENT_TIMESTAMP() WHERE TRANSACTION_ID = ?`,
    [status, transaction_id]
  );
}

async function ping() {
  await execute('SELECT 1');
}

module.exports = {
  insertTransaction,
  updateTransactionStatus,
  ping,
};
