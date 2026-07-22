const functions = require("../structs/functions.js");
const log = require("../structs/log.js");
const config = require("../Config/config.json");

const queue = new Map();
const activeSessions = new Map();

const MATCH_START_DELAY = 5000;
const QUEUE_TICK_INTERVAL = 2000;

function getQueueSize(playlist) {
    const q = queue.get(playlist);
    return q ? q.length : 0;
}

function getPlayerQueuePosition(accountId, playlist) {
    const q = queue.get(playlist);
    if (!q) return -1;
    return q.findIndex(p => p.accountId === accountId);
}

function addToQueue(accountId, playlist, ws) {
    if (!queue.has(playlist)) queue.set(playlist, []);

    const existing = queue.get(playlist).find(p => p.accountId === accountId);
    if (existing) return false;

    queue.get(playlist).push({
        accountId,
        playlist,
        ws,
        joinedAt: Date.now()
    });

    return true;
}

function removeFromQueue(accountId, playlist) {
    const q = queue.get(playlist);
    if (!q) return;

    const idx = q.findIndex(p => p.accountId === accountId);
    if (idx !== -1) {
        q.splice(idx, 1);
    }

    if (q.length === 0) queue.delete(playlist);
}

function cleanupSession(accountId) {
    const session = activeSessions.get(accountId);
    if (session) {
        clearTimeout(session.timeout);
        activeSessions.delete(accountId);
    }

    for (const [playlist, q] of queue) {
        const idx = q.findIndex(p => p.accountId === accountId);
        if (idx !== -1) {
            q.splice(idx, 1);
            if (q.length === 0) queue.delete(playlist);
        }
    }
}

function sendStatus(ws, status) {
    try {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(status));
        }
    } catch (e) {
    }
}

function selectGameServer(playlist) {
    const gameServers = config.gameServerIP;
    if (!gameServers || gameServers.length === 0) return null;

    const normalizedPlaylist = playlist.toLowerCase();
    let selected = gameServers.find(s => s.split(":")[2] && s.split(":")[2].toLowerCase() === normalizedPlaylist);

    if (!selected) {
        selected = gameServers[0];
    }

    if (!selected) return null;

    const parts = selected.split(":");
    return { ip: parts[0], port: parts[1], playlist: parts[2] };
}

function startMatchForPlayers(players, playlist) {
    const matchId = functions.MakeID().replace(/-/ig, "");
    const sessionId = functions.MakeID().replace(/-/ig, "");

    const server = selectGameServer(playlist);
    if (!server) {
        players.forEach(p => {
            sendStatus(p.ws, {
                payload: { state: "Connecting", errorMessage: "No game server available" },
                name: "StatusUpdate"
            });
            removeFromQueue(p.accountId, playlist);
            try { p.ws.close(); } catch {}
        });
        return;
    }


    players.forEach((player, index) => {
        const playerSessionId = functions.MakeID().replace(/-/ig, "");
        const ticketId = functions.MakeID().replace(/-/ig, "");

        activeSessions.set(player.accountId, {
            matchId,
            sessionId: playerSessionId,
            playlist,
            server,
            startedAt: Date.now(),
            timeout: null
        });

        sendStatus(player.ws, {
            payload: { state: "Connecting" },
            name: "StatusUpdate"
        });

        setTimeout(() => {
            sendStatus(player.ws, {
                payload: {
                    totalPlayers: players.length,
                    connectedPlayers: index + 1,
                    state: "Waiting"
                },
                name: "StatusUpdate"
            });
        }, 800);

        setTimeout(() => {
            sendStatus(player.ws, {
                payload: {
                    ticketId,
                    queuedPlayers: 0,
                    estimatedWaitSec: 0,
                    status: {},
                    state: "Queued"
                },
                name: "StatusUpdate"
            });
        }, 1800);

        setTimeout(() => {
            sendStatus(player.ws, {
                payload: { matchId, state: "SessionAssignment" },
                name: "StatusUpdate"
            });
        }, 2500);

        setTimeout(() => {
            sendStatus(player.ws, {
                payload: {
                    matchId,
                    sessionId: playerSessionId,
                    joinDelaySec: 1
                },
                name: "Play"
            });

            try {
                player.ws.close(1000);
            } catch {}

            if (queue.has(playlist)) {
                const q = queue.get(playlist);
                const idx = q.findIndex(p => p.accountId === player.accountId);
                if (idx !== -1) q.splice(idx, 1);
                if (q.length === 0) queue.delete(playlist);
            }
        }, 3500);
    });
}

function tryMatchQueue(playlist) {
    const q = queue.get(playlist);
    if (!q || q.length === 0) return;

    const playersPerMatch = playlist.toLowerCase().includes("solo") ? 1 :
                             playlist.toLowerCase().includes("duo") ? 2 :
                             playlist.toLowerCase().includes("squad") ? 4 : 1;

    if (q.length >= playersPerMatch) {
        const matched = q.splice(0, playersPerMatch);
        if (q.length === 0) queue.delete(playlist);
        startMatchForPlayers(matched, playlist);
    }
}

setInterval(() => {
    for (const [playlist] of queue) {
        tryMatchQueue(playlist);
    }
}, QUEUE_TICK_INTERVAL);

module.exports = async (ws) => {
    let accountId = null;
    let playlist = null;
    let inQueue = false;

    ws.on("message", async (raw) => {
        try {
            const msg = JSON.parse(raw);

            if (msg.name === "Matchmaking") {
                accountId = msg.payload.accountId;
                playlist = msg.payload.playlist || "solo";

                const added = addToQueue(accountId, playlist, ws);
                if (!added) {
                    sendStatus(ws, {
                        payload: { state: "Connecting", errorMessage: "Already in queue" },
                        name: "StatusUpdate"
                    });
                    return;
                }

                inQueue = true;

                sendStatus(ws, {
                    payload: { state: "Connecting" },
                    name: "StatusUpdate"
                });

                setTimeout(() => {
                    sendStatus(ws, {
                        payload: {
                            totalPlayers: getQueueSize(playlist),
                            connectedPlayers: 1,
                            state: "Waiting"
                        },
                        name: "StatusUpdate"
                    });
                }, 800);

                setTimeout(() => {
                    if (ws.readyState !== ws.OPEN) return;
                    sendStatus(ws, {
                        payload: {
                            ticketId: functions.MakeID().replace(/-/ig, ""),
                            queuedPlayers: getQueueSize(playlist) - 1,
                            estimatedWaitSec: Math.max(0, (getQueueSize(playlist) - 1) * 3),
                            status: {},
                            state: "Queued"
                        },
                        name: "StatusUpdate"
                    });
                }, 1800);

            } else if (msg.name === "ExitMatchmaker") {
                cleanupSession(accountId);
                inQueue = false;
                try { ws.close(1000); } catch {}
            }
        } catch {}
    });

    ws.on("close", () => {
        if (inQueue && accountId) {
            removeFromQueue(accountId, playlist);
            inQueue = false;
        }
        cleanupSession(accountId);
    });

    ws.on("error", () => {
        if (inQueue && accountId) {
            removeFromQueue(accountId, playlist);
            inQueue = false;
        }
        cleanupSession(accountId);
    });

    sendStatus(ws, {
        payload: { state: "Connecting" },
        name: "StatusUpdate"
    });

    setTimeout(() => {
        if (ws.readyState !== ws.OPEN) return;
        sendStatus(ws, {
            payload: {
                totalPlayers: 0,
                connectedPlayers: 0,
                state: "Waiting"
            },
            name: "StatusUpdate"
        });
    }, 800);
};

module.exports.queue = queue;
module.exports.activeSessions = activeSessions;
module.exports.getQueueSize = getQueueSize;
module.exports.addToQueue = addToQueue;
module.exports.removeFromQueue = removeFromQueue;
module.exports.cleanupSession = cleanupSession;
