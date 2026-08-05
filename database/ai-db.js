const mysql = require("mysql2/promise");

const aiDb = mysql.createPool({
  host: process.env.AI_DB_HOST,
  port: Number(process.env.AI_DB_PORT || 3306),
  user: process.env.AI_DB_USER,
  password: process.env.AI_DB_PASSWORD,
  database: process.env.AI_DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = aiDb;