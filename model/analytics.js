const mongoose = require("mongoose");

const AnalyticsSchema = new mongoose.Schema(
    {
        accountId: { type: String, required: true, unique: true },
        totalPlayTimeMs: { type: Number, default: 0 },
        sessionCount: { type: Number, default: 0 },
        matchesPlayed: { type: Number, default: 0 },
        matchesWon: { type: Number, default: 0 },
        totalKills: { type: Number, default: 0 },
        totalDeaths: { type: Number, default: 0 },
        playTimeByPlaylist: { type: Object, default: {} },
        matchesByPlaylist: { type: Object, default: {} },
        lastLogin: { type: Date, default: null },
        lastSessionStart: { type: Date, default: null },
        sessions: { type: Array, default: [] },
        dailyStats: { type: Object, default: {} },
        peakConcurrentPlayers: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    },
    {
        collection: "analytics"
    }
);

AnalyticsSchema.pre("save", function (next) {
    this.updatedAt = new Date();
    next();
});

const model = mongoose.model("AnalyticsSchema", AnalyticsSchema);

module.exports = model;
