const { AsyncLocalStorage } = require("async_hooks");
const config = require("./config.js");

// Holds the authenticated user for the lifetime of a request so that code deep
// in the stack (database, factory calls) can attribute log events to a user
// without changing any function signatures.
const requestContext = new AsyncLocalStorage();

class Logger {
  // Express middleware: app.use(logger.httpLogger) (after json parsing and auth).
  httpLogger = (req, res, next) => {
    const user = req.user ? { id: req.user.id, email: req.user.email } : undefined;
    requestContext.run({ user }, () => {
      const send = res.send;
      res.send = (resBody) => {
        this.log(this.statusToLogLevel(res.statusCode), "http", {
          authorized: !!req.headers.authorization,
          user,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          reqBody: req.body,
          resBody: this.parseBody(resBody),
        });
        res.send = send;
        return res.send(resBody);
      };
      next();
    });
  };

  dbLogger(sql, params) {
    this.log("info", "db", { user: this.currentUser(), sql, params });
  }

  factoryLogger(reqBody, resBody, statusCode) {
    const level = statusCode >= 400 ? "warn" : "info";
    this.log(level, "factory", {
      user: this.currentUser(),
      statusCode,
      reqBody,
      resBody,
    });
  }

  unhandledErrorLogger(err, req) {
    this.log("error", "exception", {
      user: this.currentUser(),
      method: req?.method,
      path: req?.originalUrl,
      message: err.message,
      stack: err.stack,
    });
  }

  currentUser() {
    return requestContext.getStore()?.user;
  }

  parseBody(body) {
    if (typeof body !== "string") return body;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  log(level, type, logData) {
    const labels = { component: config.logging.source, level, type };
    const values = [this.nowString(), this.sanitize(logData)];
    this.sendLogToGrafana({ streams: [{ stream: labels, values: [values] }] });
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return "error";
    if (statusCode >= 400) return "warn";
    return "info";
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  // Masks values of sensitive keys, in any nesting depth, before stringifying.
  sanitize(logData) {
    const sensitive = /password|token|jwt|apikey|api_key|authorization|secret/i;
    const text = JSON.stringify(logData, (key, value) =>
      sensitive.test(key) ? "*****" : value,
    );
    // Also catch secrets embedded inside already-stringified values (e.g. SQL text).
    return (text ?? "")
      .replace(/(password\s*=\s*)'[^']*'/gi, "$1'*****'")
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "*****");
  }

  sendLogToGrafana(event) {
    const { endpointUrl, accountId, apiKey } = config.logging;
    fetch(endpointUrl, {
      method: "post",
      body: JSON.stringify(event),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accountId}:${apiKey}`,
      },
    })
      .then((res) => {
        if (!res.ok) console.log("Failed to send log to Grafana");
      })
      .catch(() => console.log("Failed to send log to Grafana"));
  }
}

module.exports = new Logger();
