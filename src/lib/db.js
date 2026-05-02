const { Pool } = require("pg");
const logger = require("./logger");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DB_POOL_MIN || "2"),
  max: parseInt(process.env.DB_POOL_MAX || "10"),
});

pool.on("error", (err) => {
  logger.error("Unexpected DB pool error", { error: err.message });
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
