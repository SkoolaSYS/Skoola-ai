const mysql = require("mysql2/promise");

const aiDb = mysql.createPool({
  host: "72.61.151.99",
  port: 3306,
  user: "root",
  password: "root",
  database: "school",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = aiDb;