const mysql = require("mysql2/promise");

const schoolDb = mysql.createPool({
  host: process.env.SCHOOL_DB_HOST,
  port: Number(process.env.SCHOOL_DB_PORT || 3306),
  user: process.env.SCHOOL_DB_USER,
  password: process.env.SCHOOL_DB_PASSWORD,
  database: process.env.SCHOOL_DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = schoolDb;