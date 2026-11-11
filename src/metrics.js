const os = require("os");
const config = require("./config.js");

// ---- Counters (cumulative since the server started; use rate() in Grafana) ----
const requestsByMethod = { GET: 0, POST: 0, PUT: 0, DELETE: 0 };
const responsesByStatus = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
let latencyMsTotal = 0; // total time spent handling requests
let latencyCount = 0; // number of requests timed (divide the two for the average)
let latencyMaxMs = 0; // slowest request since the last report (gauge)

const auth = { success: 0, failure: 0 };

let pizzasSold = 0;
let pizzaFailures = 0;
let revenue = 0;
let pizzaLatencyMsTotal = 0;
let pizzaLatencyCount = 0;
let pizzaLatencyMaxMs = 0;

// userId -> time we last saw them make an authenticated request
const activeUsers = new Map();
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ---- Middleware: app.use(metrics.requestTracker) ----
function requestTracker(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - start;
    const path = req.originalUrl.split("?")[0];

    // HTTP requests by method, responses by status class
    if (req.method in requestsByMethod) requestsByMethod[req.method]++;
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    if (statusClass in responsesByStatus) responsesByStatus[statusClass]++;

    // Latency of every endpoint
    latencyMsTotal += ms;
    latencyCount++;
    latencyMaxMs = Math.max(latencyMaxMs, ms);

    // Auth attempts: register (POST /api/auth) and login (PUT /api/auth)
    if (
      path === "/api/auth" &&
      (req.method === "POST" || req.method === "PUT")
    ) {
      if (res.statusCode < 400) auth.success++;
      else auth.failure++;
    }

    // Active users: anyone who made an authenticated request; logout removes them
    if (req.user && req.user.id !== undefined) {
      if (req.method === "DELETE" && path === "/api/auth") {
        activeUsers.delete(req.user.id);
      } else {
        activeUsers.set(req.user.id, Date.now());
      }
    }
  });

  next();
}

// ---- Called from orderRouter after the pizza factory responds ----
function pizzaPurchase(success, latencyMs, price, pizzaCount = 1) {
  pizzaLatencyMsTotal += latencyMs;
  pizzaLatencyCount++;
  pizzaLatencyMaxMs = Math.max(pizzaLatencyMaxMs, latencyMs);

  if (success) {
    pizzasSold += pizzaCount;
    revenue += price;
  } else {
    pizzaFailures += pizzaCount;
  }
}

// ---- System metrics ----
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Number((cpuUsage * 100).toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

function getActiveUserCount() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [id, lastSeen] of activeUsers) {
    if (lastSeen < cutoff) activeUsers.delete(id);
  }
  return activeUsers.size;
}

// ---- Sending to Grafana ----
// attributes is an optional object like { method: "GET" } used to filter/group in Grafana.
function sendMetricToGrafana(
  metricName,
  metricValue,
  type,
  unit,
  attributes = {},
) {
  const allAttributes = { source: config.metrics.source, ...attributes };

  const metric = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: metricName,
                unit: unit,
                [type]: {
                  dataPoints: [
                    {
                      asDouble: metricValue, // asDouble so decimals (CPU %, revenue) aren't rounded
                      timeUnixNano: Date.now() * 1000000,
                      attributes: Object.entries(allAttributes).map(
                        ([key, value]) => ({
                          key,
                          value: { stringValue: String(value) },
                        }),
                      ),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  if (type === "sum") {
    metric.resourceMetrics[0].scopeMetrics[0].metrics[0][
      type
    ].aggregationTemporality = "AGGREGATION_TEMPORALITY_CUMULATIVE";
    metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].isMonotonic =
      true;
  }

  const body = JSON.stringify(metric);
  fetch(config.metrics.endpointUrl, {
    method: "POST",
    body: body,
    headers: {
      Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        response.text().then((text) => {
          console.error(
            `Failed to push metrics data to Grafana: ${text}\n${body}`,
          );
        });
      }
    })
    .catch((error) => {
      console.error("Error pushing metrics:", error);
    });
}

function sendAllMetrics() {
  // HTTP
  for (const [method, count] of Object.entries(requestsByMethod)) {
    sendMetricToGrafana("http_requests", count, "sum", "1", { method });
  }
  for (const [status, count] of Object.entries(responsesByStatus)) {
    sendMetricToGrafana("http_responses", count, "sum", "1", { status });
  }

  // Users and auth
  sendMetricToGrafana("active_users", getActiveUserCount(), "gauge", "1");
  sendMetricToGrafana("auth_attempts", auth.success, "sum", "1", {
    result: "success",
  });
  sendMetricToGrafana("auth_attempts", auth.failure, "sum", "1", {
    result: "failure",
  });

  // System
  sendMetricToGrafana("cpu_usage", getCpuUsagePercentage(), "gauge", "%");
  sendMetricToGrafana("memory_usage", getMemoryUsagePercentage(), "gauge", "%");

  // Pizzas
  sendMetricToGrafana("pizzas_sold", pizzasSold, "sum", "1");
  sendMetricToGrafana("pizza_failures", pizzaFailures, "sum", "1");
  sendMetricToGrafana("revenue", revenue, "sum", "1");

  // Latency: average = rate(total) / rate(count); max is the slowest since last report
  sendMetricToGrafana("endpoint_latency", latencyMsTotal, "sum", "ms");
  sendMetricToGrafana("endpoint_latency_count", latencyCount, "sum", "1");
  sendMetricToGrafana("endpoint_latency_max", latencyMaxMs, "gauge", "ms");
  sendMetricToGrafana("pizza_latency", pizzaLatencyMsTotal, "sum", "ms");
  sendMetricToGrafana("pizza_latency_count", pizzaLatencyCount, "sum", "1");
  sendMetricToGrafana("pizza_latency_max", pizzaLatencyMaxMs, "gauge", "ms");

  // The max gauges only describe the last interval
  latencyMaxMs = 0;
  pizzaLatencyMaxMs = 0;
}

// Called once from index.js (not from tests)
function start(period = 10000) {
  const timer = setInterval(() => {
    try {
      sendAllMetrics();
    } catch (error) {
      console.log("Error sending metrics", error);
    }
  }, period);
  timer.unref(); // don't keep the process alive just for metrics
}

module.exports = { requestTracker, pizzaPurchase, start };
