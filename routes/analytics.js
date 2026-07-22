const express = require("express");
const app = express.Router();
const log = require("../structs/log.js");
const Analytics = require("../model/analytics.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");
const { RateLimiter } = require("../structs/rateLimiter.js");

app.post("/fortnite/api/analytics/session/start", verifyToken, async (req, res) => {
    try {
        const { accountId } = req.user;
        const now = new Date();
        const today = now.toISOString().split("T")[0];

        let analytics = await Analytics.findOne({ accountId });
        if (!analytics) {
            analytics = new Analytics({ accountId });
        }

        analytics.lastLogin = now;
        analytics.lastSessionStart = now;
        analytics.sessionCount += 1;

        if (!analytics.dailyStats[today]) {
            analytics.dailyStats[today] = { sessions: 0, playTimeMs: 0, matches: 0 };
        }
        analytics.dailyStats[today].sessions += 1;

        const keys = Object.keys(analytics.dailyStats);
        if (keys.length > 30) {
            const sortedKeys = keys.sort();
            for (let i = 0; i < keys.length - 30; i++) {
                delete analytics.dailyStats[sortedKeys[i]];
            }
        }

        await analytics.save();

        const onlineCount = global.Clients ? global.Clients.length : 0;
        if (onlineCount > analytics.peakConcurrentPlayers) {
            analytics.peakConcurrentPlayers = onlineCount;
            await analytics.save();
        }

        res.status(204).end();
    } catch (err) {
        log.error("Analytics session start error:", err);
        res.status(204).end();
    }
});

app.post("/fortnite/api/analytics/session/end", verifyToken, async (req, res) => {
    try {
        const { accountId } = req.user;
        const { playTimeMs, playlist, kills, deaths, won } = req.body || {};

        let analytics = await Analytics.findOne({ accountId });
        if (!analytics) {
            analytics = new Analytics({ accountId });
        }

        const now = new Date();
        const today = now.toISOString().split("T")[0];

        if (analytics.lastSessionStart) {
            const sessionDuration = playTimeMs || (now.getTime() - analytics.lastSessionStart.getTime());
            analytics.totalPlayTimeMs += Math.max(0, sessionDuration);

            if (!analytics.dailyStats[today]) {
                analytics.dailyStats[today] = { sessions: 0, playTimeMs: 0, matches: 0 };
            }
            analytics.dailyStats[today].playTimeMs += sessionDuration;
        }

        if (playlist) {
            if (!analytics.playTimeByPlaylist[playlist]) analytics.playTimeByPlaylist[playlist] = 0;
            analytics.playTimeByPlaylist[playlist] += playTimeMs || 0;

            if (!analytics.matchesByPlaylist[playlist]) analytics.matchesByPlaylist[playlist] = 0;
            analytics.matchesByPlaylist[playlist] += 1;
        }

        if (kills) analytics.totalKills += kills;
        if (deaths) analytics.totalDeaths += deaths;

        analytics.matchesPlayed += 1;
        if (won) analytics.matchesWon += 1;

        if (analytics.dailyStats[today]) {
            analytics.dailyStats[today].matches += 1;
        }

        analytics.lastSessionStart = null;

        await analytics.save();

        res.status(204).end();
    } catch (err) {
        log.error("Analytics session end error:", err);
        res.status(204).end();
    }
});

app.get("/fortnite/api/analytics/stats", verifyToken, async (req, res) => {
    try {
        const { accountId } = req.user;

        const analytics = await Analytics.findOne({ accountId }).lean();
        if (!analytics) {
            return res.json({
                accountId,
                totalPlayTimeMs: 0,
                sessionCount: 0,
                matchesPlayed: 0,
                matchesWon: 0,
                winRate: 0,
                totalKills: 0,
                totalDeaths: 0,
                kd: 0,
                playTimeByPlaylist: {},
                matchesByPlaylist: {},
                dailyStats: {}
            });
        }

        res.json({
            accountId: analytics.accountId,
            totalPlayTimeMs: analytics.totalPlayTimeMs,
            sessionCount: analytics.sessionCount,
            matchesPlayed: analytics.matchesPlayed,
            matchesWon: analytics.matchesWon,
            winRate: analytics.matchesPlayed > 0 ? (analytics.matchesWon / analytics.matchesPlayed * 100).toFixed(2) + "%" : "0%",
            totalKills: analytics.totalKills,
            totalDeaths: analytics.totalDeaths,
            kd: analytics.totalDeaths > 0 ? (analytics.totalKills / analytics.totalDeaths).toFixed(2) : analytics.totalKills.toString(),
            playTimeByPlaylist: analytics.playTimeByPlaylist,
            matchesByPlaylist: analytics.matchesByPlaylist,
            dailyStats: analytics.dailyStats
        });
    } catch (err) {
        log.error("Analytics stats error:", err);
        res.status(500).json({ error: "Failed to fetch analytics" });
    }
});

app.get("/fortnite/api/analytics/leaderboard", async (req, res) => {
    try {
        const sortBy = req.query.sort || "matchesPlayed";
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);

        const validSortFields = ["totalPlayTimeMs", "matchesPlayed", "matchesWon", "totalKills"];
        const sortField = validSortFields.includes(sortBy) ? sortBy : "matchesPlayed";

        const leaderboard = await Analytics.find({})
            .sort({ [sortField]: -1 })
            .limit(limit)
            .lean();

        const result = leaderboard.map((entry, idx) => ({
            rank: idx + 1,
            accountId: entry.accountId,
            matchesPlayed: entry.matchesPlayed,
            matchesWon: entry.matchesWon,
            totalKills: entry.totalKills,
            totalPlayTimeMs: entry.totalPlayTimeMs
        }));

        res.json(result);
    } catch (err) {
        log.error("Analytics leaderboard error:", err);
        res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
});

app.get("/fortnite/api/analytics/server", async (req, res) => {
    try {
        const onlineCount = global.Clients ? global.Clients.length : 0;

        let allAnalytics = await Analytics.find({}).lean();

        let totalPlayTime = 0;
        let totalMatches = 0;
        let totalKills = 0;

        for (const a of allAnalytics) {
            totalPlayTime += a.totalPlayTimeMs || 0;
            totalMatches += a.matchesPlayed || 0;
            totalKills += a.totalKills || 0;
        }

        const totalRegistered = allAnalytics.length;

        const rateStats = RateLimiter.getStats();

        res.json({
            onlinePlayers: onlineCount,
            totalRegisteredPlayers: totalRegistered,
            totalPlayTimeMs: totalPlayTime,
            totalMatchesPlayed: totalMatches,
            totalKills: totalKills,
            rateLimiterStats: rateStats,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        log.error("Analytics server error:", err);
        res.status(500).json({ error: "Failed to fetch server analytics" });
    }
});

module.exports = app;
