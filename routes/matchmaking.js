const express = require("express");
const app = express.Router();
const config = require("../Config/config.json");
const functions = require("../structs/functions.js");
const log = require("../structs/log.js");
const MMCode = require("../model/mmcodes.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");
const qs = require("qs");
const error = require("../structs/error.js");
const matchmaker = require("../matchmaker/matchmaker.js");
const { checkMatchmakingBan, checkCompetitiveBan } = require("../middleware/anticheat.js");
const Tournament = require("../model/tournament.js");

let buildUniqueId = {};

app.get("/fortnite/api/matchmaking/session/findPlayer/*", (req, res) => {
    log.debug("GET /fortnite/api/matchmaking/session/findPlayer/* called");
    res.status(200);
    res.end();
});

app.get("/fortnite/api/game/v2/matchmakingservice/ticket/player/*", verifyToken, checkMatchmakingBan, checkCompetitiveBan, async (req, res) => {
    log.debug("GET /fortnite/api/game/v2/matchmakingservice/ticket/player/* called");
    if (req.user.isServer == true) return res.status(403).end();
    if (req.user.matchmakingId == null) return res.status(400).end();

    const playerCustomKey = qs.parse(req.url.split("?")[1], { ignoreQueryPrefix: true })['player.option.customKey'];
    const bucketId = qs.parse(req.url.split("?")[1], { ignoreQueryPrefix: true })['bucketId'];
    if (typeof bucketId !== "string" || bucketId.split(":").length !== 4) {
        return res.status(400).end();
    }
    const rawPlaylist = bucketId.split(":")[3];
    let playlist = functions.PlaylistNames(rawPlaylist).toLowerCase();

    // ShowdownAlt (Arena) playlist mappings
    if (playlist === "2" || playlist === "playlist_defaultsolo") {
        playlist = "playlist_defaultsolo";
    } else if (playlist === "10" || playlist === "playlist_defaultduo") {
        playlist = "playlist_defaultduo";
    } else if (playlist === "9" || playlist === "playlist_defaultsquad") {
        playlist = "playlist_defaultsquad";
    } else if (playlist === "50" || playlist === "11" || playlist === "playlist_50v50") {
        playlist = "playlist_50v50";
    } else if (playlist === "13" || playlist === "24" || playlist === "playlist_highexplosives_squads") {
        playlist = "playlist_highexplosives_squads";
    } else if (playlist === "22" || playlist === "playlist_5x20") {
        playlist = "playlist_5x20";
    } else if (playlist === "36" || playlist === "playlist_blitz_solo") {
        playlist = "playlist_blitz_solo";
    } else if (playlist === "37" || playlist === "playlist_blitz_duos") {
        playlist = "playlist_blitz_duos";
    } else if (playlist === "19" || playlist === "playlist_blitz_squad") {
        playlist = "playlist_blitz_squad";
    } else if (playlist === "33" || playlist === "playlist_carmine") {
        playlist = "playlist_carmine";
    } else if (playlist === "32" || playlist === "playlist_fortnite") {
        playlist = "playlist_fortnite";
    } else if (playlist === "23" || playlist === "playlist_showdowntournament_solo") {
        playlist = "playlist_showdowntournament_solo";
    } else if (playlist === "44" || playlist === "playlist_impact_solo") {
        playlist = "playlist_impact_solo";
    } else if (playlist === "45" || playlist === "playlist_impact_duos") {
        playlist = "playlist_impact_duos";
    } else if (playlist === "46" || playlist === "playlist_impact_squads") {
        playlist = "playlist_impact_squads";
    } else if (playlist === "35" || playlist === "playlist_playground") {
        playlist = "playlist_playground";
    } else if (playlist === "30" || playlist === "playlist_skysupply") {
        playlist = "playlist_skysupply";
    } else if (playlist === "42" || playlist === "playlist_skysupply_duos") {
        playlist = "playlist_skysupply_duos";
    } else if (playlist === "43" || playlist === "playlist_skysupply_squads") {
        playlist = "playlist_skysupply_squads";
    } else if (playlist === "41" || playlist === "playlist_snipers") {
        playlist = "playlist_snipers";
    } else if (playlist === "39" || playlist === "playlist_snipers_solo") {
        playlist = "playlist_snipers_solo";
    } else if (playlist === "40" || playlist === "playlist_snipers_duos") {
        playlist = "playlist_snipers_duos";
    } else if (playlist === "26" || playlist === "playlist_solidgold_solo") {
        playlist = "playlist_solidgold_solo";
    } else if (playlist === "27" || playlist === "playlist_solidgold_squads") {
        playlist = "playlist_solidgold_squads";
    } else if (playlist === "28" || playlist === "playlist_showdownalt_solo") {
        playlist = "playlist_showdownalt_solo";
    } else if (playlist === "29" || playlist === "playlist_showdownalt_duos") {
        playlist = "playlist_showdownalt_duos";
    }

    const gameServers = config.gameServerIP;
    let selectedServer = gameServers.find(server => server.split(":")[2].toLowerCase() === playlist);
    if (!selectedServer) {
        log.debug("No server found for playlist", playlist);
        return error.createError("errors.com.epicgames.common.matchmaking.playlist.not_found", `No server found for playlist ${playlist}`, [], 1013, "invalid_playlist", 404, res);
    }
    await global.kv.set(`playerPlaylist:${req.user.accountId}`, playlist);

    // Auto-create tournament document for Showdown (arena) playlists
    const isTournamentPlaylist = playlist === "playlist_showdowntournament_solo" ||
                                 playlist === "playlist_showdownalt_solo" ||
                                 playlist === "playlist_showdownalt_duos" ||
                                 (playlist && typeof playlist === 'string' && playlist.toLowerCase().includes("showdown")) ||
                                 (playlist && typeof playlist === 'string' && playlist.toLowerCase().includes("tournament"));

    if (isTournamentPlaylist) {
        try {
            const existingTournament = await Tournament.findOne({ accountId: req.user.accountId });
            if (!existingTournament) {
                await Tournament.create({
                    accountId: req.user.accountId,
                    username: req.user.username || "Unknown",
                    tournamentPoints: 0,
                    wins: 0,
                    eliminations: 0,
                    matchesPlayed: 0,
                    season: "Chapter 2 Season 2",
                    version: "12.41",
                    hasReceivedTopReward: false,
                    lastUpdated: new Date()
                });
                log.debug(`Created tournament document for ${req.user.accountId}`);
            }
        } catch (err) {
            log.error(`Error creating tournament document: ${err.message}`);
        }
    }

    if (typeof playerCustomKey == "string") {
        let codeDocument = await MMCode.findOne({ code_lower: playerCustomKey?.toLowerCase() });
        if (!codeDocument) {
            return error.createError("errors.com.epicgames.common.matchmaking.code.not_found", `The matchmaking code "${playerCustomKey}" was not found`, [], 1013, "invalid_code", 404, res);
        }
        const kvDocument = JSON.stringify({
            ip: codeDocument.ip,
            port: codeDocument.port,
            playlist: playlist,
        });
        await global.kv.set(`playerCustomKey:${req.user.accountId}`, kvDocument);
    }
    if (typeof req.query.bucketId !== "string" || req.query.bucketId.split(":").length !== 4) {
        return res.status(400).end();
    }

    buildUniqueId[req.user.accountId] = req.query.bucketId.split(":")[0];

    const matchmakerIP = config.matchmakerIP;
    return res.json({
        "serviceUrl": matchmakerIP.includes("ws") || matchmakerIP.includes("wss") ? matchmakerIP : `ws://${matchmakerIP}`,
        "ticketType": "mms-player",
        "payload": `${req.user.matchmakingId}`,
        "signature": "account"
    });
});

app.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", (req, res) => {
    log.debug(`GET /fortnite/api/game/v2/matchmaking/account/${req.params.accountId}/session/${req.params.sessionId} called`);
    res.json({
        "accountId": req.params.accountId,
        "sessionId": req.params.sessionId,
        "key": "none"
    });
});

app.get("/fortnite/api/matchmaking/session/:sessionId", verifyToken, async (req, res) => {
    log.debug(`GET /fortnite/api/matchmaking/session/${req.params.sessionId} called`);
    const playlist = await global.kv.get(`playerPlaylist:${req.user.accountId}`);
    let kvDocument = await global.kv.get(`playerCustomKey:${req.user.accountId}`);
    if (!kvDocument) {
        const gameServers = config.gameServerIP;
        let selectedServer = gameServers.find(server => server.split(":")[2] === playlist);
        if (!selectedServer) {
            log.debug("No server found for playlist", playlist);
            return error.createError("errors.com.epicgames.common.matchmaking.playlist.not_found", `No server found for playlist ${playlist}`, [], 1013, "invalid_playlist", 404, res);
        }
        kvDocument = JSON.stringify({
            ip: selectedServer.split(":")[0],
            port: selectedServer.split(":")[1],
            playlist: selectedServer.split(":")[2]
        });
    }
    let codeKV = JSON.parse(kvDocument);

    res.json({
        "id": req.params.sessionId,
        "ownerId": functions.MakeID().replace(/-/ig, "").toUpperCase(),
        "ownerName": "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
        "serverName": "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
        "serverAddress": codeKV.ip,
        "serverPort": codeKV.port,
        "maxPublicPlayers": 220,
        "openPublicPlayers": 175,
        "maxPrivatePlayers": 0,
        "openPrivatePlayers": 0,
        "attributes": {
          "REGION_s": "EU",
          "GAMEMODE_s": "FORTATHENA",
          "ALLOWBROADCASTING_b": true,
          "SUBREGION_s": "GB",
          "DCID_s": "FORTNITE-LIVEEUGCEC1C2E30UBRCORE0A-14840880",
          "tenant_s": "Fortnite",
          "MATCHMAKINGPOOL_s": "Any",
          "STORMSHIELDDEFENSETYPE_i": 0,
          "HOTFIXVERSION_i": 0,
          "PLAYLISTNAME_s": codeKV.playlist,
          "SESSIONKEY_s": functions.MakeID().replace(/-/ig, "").toUpperCase(),
          "TENANT_s": "Fortnite",
          "BEACONPORT_i": 15009
        },
        "publicPlayers": [],
        "privatePlayers": [],
        "totalPlayers": 45,
        "allowJoinInProgress": false,
        "shouldAdvertise": false,
        "isDedicated": false,
        "usesStats": false,
        "allowInvites": false,
        "usesPresence": false,
        "allowJoinViaPresence": true,
        "allowJoinViaPresenceFriendsOnly": false,
        "buildUniqueId": buildUniqueId[req.user.accountId] || "0",
        "lastUpdated": new Date().toISOString(),
        "started": false
      });
});

app.post("/fortnite/api/matchmaking/session/*/join", verifyToken, async (req, res) => {
    log.debug("POST /fortnite/api/matchmaking/session/*/join called");
    res.status(204);
    res.end();
});

app.post("/fortnite/api/matchmaking/session/matchMakingRequest", (req, res) => {
    log.debug("POST /fortnite/api/matchmaking/session/matchMakingRequest called");
    res.json([]);
});

app.post("/fortnite/api/matchmaking/session/leave", verifyToken, async (req, res) => {
    log.debug("POST /fortnite/api/matchmaking/session/leave called");

    const accountId = req.user.accountId;

    matchmaker.cleanupSession(accountId);

    await global.kv.set(`playerPlaylist:${accountId}`, undefined);
    await global.kv.set(`playerCustomKey:${accountId}`, undefined);

    delete buildUniqueId[accountId];

    let partyIds = Object.keys(global.parties || {});
    for (let pid of partyIds) {
        let party = global.parties[pid];
        let mIndex = party.members.findIndex(m => m.account_id == accountId);
        if (mIndex != -1) {
            party.members.splice(mIndex, 1);
            if (party.members.length == 0) {
                delete global.parties[pid];
            }
        }
    }

    res.status(204);
    res.end();
});

app.get("/fortnite/api/matchmaking/queue/status", verifyToken, (req, res) => {
    log.debug("GET /fortnite/api/matchmaking/queue/status called");

    const playlist = req.query.playlist || "solo";
    const queueSize = matchmaker.getQueueSize(playlist);

    res.json({
        "playlist": playlist,
        "queueSize": queueSize,
        "estimatedWaitSec": Math.max(0, queueSize * 3)
    });
});

module.exports = app;
