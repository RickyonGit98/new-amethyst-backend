const fs = require("fs");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
    bgYellow: "\x1b[43m",
    bgBlue: "\x1b[44m",
    bgMagenta: "\x1b[45m",
    bgCyan: "\x1b[46m"
};

const prefixes = {
    backend: { label: "BACKEND", color: colors.magenta, bg: colors.bgMagenta },
    bot: { label: "BOT", color: colors.yellow, bg: colors.bgYellow },
    xmpp: { label: "XMPP", color: colors.cyan, bg: colors.bgCyan },
    error: { label: "ERROR", color: colors.white, bg: colors.bgRed },
    debug: { label: "DEBUG", color: colors.gray, bg: "" },
    website: { label: "WEBSITE", color: colors.green, bg: colors.bgGreen },
    autorotation: { label: "SHOP", color: colors.cyan, bg: colors.bgCyan },
    update: { label: "UPDATE", color: colors.yellow, bg: colors.bgYellow },
    autorest: { label: "RESTART", color: colors.green, bg: colors.bgGreen },
    caldera: { label: "CALDERA", color: colors.red, bg: colors.bgRed },
    anticheat: { label: "ANTICHEAT", color: colors.red, bg: colors.bgRed },
    launcher: { label: "LAUNCHER", color: colors.blue, bg: colors.bgBlue },
    auth: { label: "AUTH", color: colors.blue, bg: colors.bgBlue },
    matchmaking: { label: "MATCH", color: colors.magenta, bg: colors.bgMagenta },
    party: { label: "PARTY", color: colors.cyan, bg: colors.bgCyan },
    friends: { label: "FRIENDS", color: colors.green, bg: colors.bgGreen },
    database: { label: "DB", color: colors.yellow, bg: colors.bgYellow }
};

const maxLabelLength = Math.max(...Object.values(prefixes).map(p => p.label.length));

function getTimestamp() {
    const now = new Date();
    const date = now.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const ms = now.getMilliseconds().toString().padStart(3, "0");
    return `${colors.gray}${date} ${time}.${ms}${colors.reset}`;
}

function formatLog(prefix, ...args) {
    const { label, color, bg } = prefix;
    const paddedLabel = label.padEnd(maxLabelLength);
    const prefixStr = bg
        ? `${bg} ${colors.bright}${colors.white}${paddedLabel}${colors.reset}`
        : `${color}${colors.bright}${paddedLabel}${colors.reset}`;
    const separator = `${colors.gray}|${colors.reset}`;
    console.log(`${getTimestamp()} ${separator} ${prefixStr} ${separator} ${color}${args.join(" ")}${colors.reset}`);
}

function backend(...args) {
    formatLog(prefixes.backend, ...args);
}

function bot(...args) {
    formatLog(prefixes.bot, ...args);
}

function xmpp(...args) {
    formatLog(prefixes.xmpp, ...args);
}

function error(...args) {
    formatLog(prefixes.error, ...args);
}

function debug(...args) {
    if (config.bEnableDebugLogs) {
        formatLog(prefixes.debug, ...args);
    }
}

function website(...args) {
    formatLog(prefixes.website, ...args);
}

function AutoRotation(...args) {
    if (config.bEnableAutoRotateDebugLogs) {
        formatLog(prefixes.autorotation, ...args);
    }
}

function checkforupdate(...args) {
    formatLog(prefixes.update, ...args);
}

function autobackendrestart(...args) {
    formatLog(prefixes.autorest, ...args);
}

function calderaservice(...args) {
    formatLog(prefixes.caldera, ...args);
}

function anticheat(...args) {
    formatLog(prefixes.anticheat, ...args);
}

function launcher(...args) {
    formatLog(prefixes.launcher, ...args);
}

function auth(...args) {
    formatLog(prefixes.auth, ...args);
}

function matchmaking(...args) {
    formatLog(prefixes.matchmaking, ...args);
}

function party(...args) {
    formatLog(prefixes.party, ...args);
}

function friends(...args) {
    formatLog(prefixes.friends, ...args);
}

function database(...args) {
    formatLog(prefixes.database, ...args);
}

module.exports = {
    backend,
    bot,
    xmpp,
    error,
    debug,
    website,
    AutoRotation,
    checkforupdate,
    autobackendrestart,
    calderaservice,
    anticheat,
    launcher,
    auth,
    matchmaking,
    party,
    friends,
    database
};