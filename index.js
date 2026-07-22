const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const os = require("os");
const perUserRateLimit = require("./structs/rateLimiter.js");
const jwt = require("jsonwebtoken");
const path = require("path");
const kv = require("./structs/kv.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const WebSocket = require("ws");
const { WebSocketServer } = require("ws");
const http = require("http");
const https = require("https");

const log = require("./structs/log.js");
const error = require("./structs/error.js");
const functions = require("./structs/functions.js");
const AutoBackendRestart = require("./structs/autobackendrestart.js");

const app = express();

log.backend("AmethystMP backend starting...");

if (!fs.existsSync("./ClientSettings")) fs.mkdirSync("./ClientSettings");

// Load or create persistent JWT secret (so tokens survive backend restart)
const jwtSecretPath = "./tokenManager/jwt_secret.txt";
if (fs.existsSync(jwtSecretPath)) {
    global.JWT_SECRET = fs.readFileSync(jwtSecretPath, 'utf8').trim();
    log.backend("JWT secret loaded from file");
} else {
    global.JWT_SECRET = functions.MakeID();
    fs.writeFileSync(jwtSecretPath, global.JWT_SECRET);
    log.backend("New JWT secret generated and saved");
}
const PORT = config.port;
const WEBSITEPORT = config.Website.websiteport;

let httpsServer;

if (config.bEnableHTTPS) {
    httpsServer = https.createServer({
        cert: fs.readFileSync(config.ssl.cert),
        ca: fs.existsSync(config.ssl.ca) ? fs.readFileSync(config.ssl.ca) : undefined,
        key: fs.readFileSync(config.ssl.key)
    }, app);
}

const tokens = JSON.parse(fs.readFileSync("./tokenManager/tokens.json").toString());

for (let tokenType in tokens) {
    for (let tokenIndex = tokens[tokenType].length - 1; tokenIndex >= 0; tokenIndex--) {
        let decodedToken = jwt.decode(tokens[tokenType][tokenIndex].token.replace("eg1~", ""));
        if (DateAddHours(new Date(decodedToken.creation_date), decodedToken.hours_expire).getTime() <= Date.now()) {
            tokens[tokenType].splice(tokenIndex, 1);
        }
    }
}

fs.writeFileSync("./tokenManager/tokens.json", JSON.stringify(tokens, null, 2));

global.accessTokens = tokens.accessTokens;
global.refreshTokens = tokens.refreshTokens;
global.clientTokens = tokens.clientTokens;
global.kv = kv;
global.exchangeCodes = [];

/* ===== UPDATE CHECKER RUN ===== */
/* ============================================= */

mongoose.set("strictQuery", true);

async function connectDatabase() {
    const dbPath = path.join(__dirname, "..", "..", "mongodb-data");
    if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath, { recursive: true });

    const mongodBinary = path.join(os.homedir(), ".cache", "mongodb-binaries", "mongod-x64-win32-8.2.6.exe");

    try {
        await mongoose.connect(config.mongodb.database, { serverSelectionTimeoutMS: 3000 });
        log.backend("Database Connected");
    } catch (err) {
        log.error(`MongoDB connection failed: ${err.message}`);
        log.backend("Starting local MongoDB server with persistent storage...");

        if (!fs.existsSync(mongodBinary)) {
            log.backend("Downloading MongoDB binary...");
            try {
                const { MongoMemoryServer } = require("mongodb-memory-server");
                const temp = await MongoMemoryServer.create({ instance: { dbPath: dbPath } });
                await temp.stop();
            } catch (e) {
                log.error(`Failed to download MongoDB: ${e.message}`);
                throw e;
            }
        }

        try {
            const lockFile = path.join(dbPath, "WiredTiger.lock");
            if (fs.existsSync(lockFile)) {
                try { fs.unlinkSync(lockFile); } catch (e) {}
            }

            const { spawn } = require("child_process");
            const logFd = fs.openSync(path.join(dbPath, "..", "mongod.log"), "a");

            global.mongodProcess = spawn(mongodBinary, [
                "--dbpath", dbPath,
                "--port", "27017"
            ], {
                stdio: ["ignore", logFd, logFd],
                detached: true
            });

            global.mongodProcess.unref();

            let connected = false;
            for (let i = 0; i < 20; i++) {
                try {
                    await mongoose.connect("mongodb://127.0.0.1:27017/Amethyst", { serverSelectionTimeoutMS: 2000 });
                    connected = true;
                    break;
                } catch (e) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            if (!connected) {
                throw new Error("Could not connect to local MongoDB after 40 seconds");
            }

            config.mongodb.database = "mongodb://127.0.0.1:27017/Amethyst";
            log.backend("Connected to local MongoDB (persistent storage)");
        } catch (memErr) {
            log.error(`Local MongoDB failed: ${memErr.message}`);
            throw memErr;
        }
    }
}

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(perUserRateLimit);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    log.debug(`${req.method} ${req.originalUrl}`);
    next();
});

fs.readdirSync("./routes").forEach(fileName => {
    try {
        app.use(require(`./routes/${fileName}`));
    } catch {
        log.error(`Routes Error: Failed to load ${fileName}`);
    }
});

fs.readdirSync("./Api").forEach(fileName => {
    try {
        app.use(require(`./Api/${fileName}`));
    } catch {
        log.error(`backend API Error: Failed to load ${fileName}`);
    }
});

app.get("/unknown", (req, res) => {
    res.json({ msg: "Made by RickyonGit98" });
});

connectDatabase().then(() => {
    const startServer = () => {
        let server;
        if (config.bEnableHTTPS) {
            server = httpsServer;
            httpsServer.listen(PORT, () => {
                log.backend(`Amethyst listening on port ${PORT} with ssl`);
                require("./xmpp/xmpp.js");
                if (config.discord.bUseDiscordBot) require("./DiscordBot");
                if (config.bUseAutoRotate) require("./structs/autorotate.js");
            });
        } else {
            server = http.createServer(app);
            server.listen(PORT, () => {
                log.backend(`Amethyst listening on port ${PORT}`);
                require("./xmpp/xmpp.js");
                if (config.discord.bUseDiscordBot) require("./DiscordBot");
                if (config.bUseAutoRotate) require("./structs/autorotate.js");
            });
        }

        // Launcher WebSocket server
        const jwt = require("jsonwebtoken");
        const User = require("./model/user.js");
        const wssLauncher = new WebSocketServer({ server });
        wssLauncher.on("connection", async (ws, req) => {
            try {
                const urlObj = new URL(req.url, "http://localhost");
                const token = urlObj.searchParams.get("token");
                if (!token) { ws.close(); return; }

                const tokenWithoutPrefix = token.replace("eg1~", "");
                let decodedToken;
                try {
                    decodedToken = jwt.decode(tokenWithoutPrefix);
                } catch { ws.close(); return; }
                if (!decodedToken) { ws.close(); return; }

                const accountId = decodedToken.sub || decodedToken.accountId;
                if (!accountId) { ws.close(); return; }

                const user = await User.findOne({ accountId }).lean();
                if (!user) { ws.close(); return; }

                ws._accountId = accountId;
                ws._token = token;
                ws._user = user;
                ws._decoded = decodedToken;

                log.launcher(`WebSocket client connected: ${user.username} (${accountId})`);

                ws.on("message", async (raw) => {
                    try {
                        const msg = JSON.parse(raw.toString());
                        const msgType = (msg.type || "").toLowerCase();

                        switch (msgType) {
                            case "ping":
                                ws.send(JSON.stringify({ type: "pong", timestamp: Date.now(), id: msg.messageId }));
                                break;

                            case "request_user":
                                const discordInfo = decodedToken.discord || {};
                                const userPayload = {
                                    token: {
                                        id: accountId,
                                        discord: {
                                            id: discordInfo.id || user.discordId || "",
                                            username: discordInfo.username || user.username || "",
                                            displayName: discordInfo.displayName || user.username || "",
                                            avatarUrl: discordInfo.avatarUrl || user.avatar || decodedToken.avatar_url || "",
                                            isDonator: discordInfo.isDonator || false,
                                        },
                                        roles: { list: decodedToken.role?.name ? [decodedToken.role.name] : [] },
                                        profile: {
                                            athena: {
                                                favoriteCharacterId: "cid_001_athena_commando_f_default",
                                                season: { level: 1, xp: 0, battlePass: { purchased: false, level: 1, xp: 0 } },
                                                hype: 0,
                                            },
                                            common_core: { vbucks: 0 },
                                            stats: {},
                                        },
                                        hellowelcometocrystalfortnite: JSON.stringify({ name: decodedToken.role?.name || 'User', color: decodedToken.role?.color || '#FFFFFF' }),
                                    },
                                };
                                ws.send(JSON.stringify({ type: "user", payload: userPayload, timestamp: Date.now(), id: msg.messageId }));
                                break;

                            default:
                                ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${msg.type}`, timestamp: Date.now(), id: msg.messageId }));
                        }
                    } catch { }
                });

                ws.on("close", () => {
                    log.launcher(`WebSocket client disconnected: ${user.username} (${accountId})`);
                });

                ws.on("error", () => {});
            } catch (err) {
                log.error(`Launcher WebSocket error: ${err.message}`);
                try { ws.close(); } catch {}
            }
        });
        log.launcher(`Launcher WebSocket server running on port ${PORT}`);

        // Load anticheat system
        try {
            require("./structs/anticheat.js");
            log.backend("Anticheat system loaded");
        } catch (e) {
            log.error(`Failed to load anticheat system: ${e.message}`);
        }

        if (config.bEnableAutoBackendRestart) {
            if (typeof config.bRestartTime === "string" && config.bRestartTime.includes(":")) {
                log.autobackendrestart("Auto restart disabled - set bRestartTime like '24h' in config");
            } else {
                AutoBackendRestart.scheduleRestart(config.bRestartTime);
            }
        }

        if (config.bEnableCalderaService) {
            const { calderaHandler } = require("./CalderaService/calderaservice");

            if (!config.bGameVersion) {
                log.calderaservice("define a version in config");
                return;
            }

            app.post("/caldera/api", (req, res) => calderaHandler(req, res));
            app.post("/eos/auth/v1/*", (req, res) => calderaHandler(req, res));

            log.calderaservice("Caldera endpoints mounted on main server (port 3551)");
        }
    };

    startServer();
}).catch(err => {
    log.error("Could not establish any database connection");
    process.exit(1);
});

if (config.Website.bUseWebsite) {
    const websiteApp = express();
    require("./Website/website")(websiteApp);

    if (config.bEnableHTTPS) {
        https.createServer({
            cert: fs.readFileSync(config.ssl.cert),
            ca: fs.existsSync(config.ssl.ca) ? fs.readFileSync(config.ssl.ca) : undefined,
            key: fs.readFileSync(config.ssl.key)
        }, websiteApp).listen(WEBSITEPORT, () => {
            log.website(`Website started listening on port ${WEBSITEPORT} (SSL Enabled)`);
        });
    } else {
        websiteApp.listen(WEBSITEPORT, () => {
            log.website(`Website started listening on port ${WEBSITEPORT}`);
        });
    }
}

app.use((req, res) => {
    if (req.url.includes("..")) {
        res.redirect("https://github.com/RickyonGit98");
        return;
    }

    error.createError(
        "errors.com.epicgames.common.not_found",
        "Sorry the resource you were trying to find could not be found",
        undefined,
        1004,
        undefined,
        404,
        res
    );
});

function DateAddHours(date, hours) {
    date.setHours(date.getHours() + hours);
    return date;
}

process.on("SIGINT", () => {
    if (global.mongodProcess) {
        global.mongodProcess.kill();
    }
    process.exit(0);
});

module.exports = app;