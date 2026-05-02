require("dotenv").config();
const app = require("./app");
const logger = require("./lib/logger");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`DecentralThink Core running on port ${PORT}`, {
    env: process.env.NODE_ENV,
    pid: process.pid,
  });
});
