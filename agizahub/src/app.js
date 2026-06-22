const express = require("express");
const routes = require("./routes");
const logger = require("./services/logger");
const { enforceHttpsAndCors } = require("./middleware/securityMiddleware");

const app = express();
app.set("trust proxy", true);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(enforceHttpsAndCors);

app.use("/", routes);

app.use((error, _req, res, _next) => {
  logger.error("Unhandled application error", { error: error.message });
  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "production" ? "Unexpected failure" : error.message,
  });
});

module.exports = app;
