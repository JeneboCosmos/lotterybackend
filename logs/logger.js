const fs = require("fs");
const path = require("path");

// ===========================
// Config
// ===========================
const LOG_DIR = path.join(__dirname, "logs");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per log file
const ENV = process.env.NODE_ENV || "development";

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Log file paths
const APP_LOG = path.join(LOG_DIR, "app.log");
const ERROR_LOG = path.join(LOG_DIR, "error.log");
const AUDIT_LOG = path.join(LOG_DIR, "audit.log");

// ===========================
// Helpers
// ===========================

/**
 * Rotate log file if it exceeds MAX_FILE_SIZE
 * @param {string} filePath
 */
function rotateLog(filePath) {
    if (!fs.existsSync(filePath)) return;

    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_FILE_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const newName = `${filePath.replace(".log", "")}-${timestamp}.log`;
        fs.renameSync(filePath, newName);
    }
}

/**
 * Write a log entry
 * @param {string} level
 * @param {string} message
 * @param {object} [meta]
 * @param {string} [type] - "APP", "ERROR", "AUDIT"
 */
function writeLog(level, message, meta = {}, type = "APP") {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        message,
        ...meta,
    };
    const logString = JSON.stringify(logEntry);

    // Choose file based on type
    let filePath;
    switch (type.toUpperCase()) {
        case "ERROR":
            filePath = ERROR_LOG;
            break;
        case "AUDIT":
            filePath = AUDIT_LOG;
            break;
        default:
            filePath = APP_LOG;
    }

    // Rotate if necessary
    rotateLog(filePath);

    // Append to file
    try {
    fs.appendFileSync(filePath, logString + "\n");
} catch (err) {
    console.error("Failed to write log:", err);
}


    // Optional console logging in dev
    if (ENV === "development") {
        console.log(logString);
    }
}

// ===========================
// Exported functions
// ===========================
module.exports = {
    // General logs
    info: (msg, meta) => writeLog("INFO", msg, meta, "APP"),
    warn: (msg, meta) => writeLog("WARN", msg, meta, "APP"),
    error: (msg, meta) => writeLog("ERROR", msg, meta, "ERROR"),

    // Audit logs
    audit: (msg, meta) => writeLog("INFO", msg, meta, "AUDIT"),

    // Generic log
    log: writeLog,
};
