const AnticheatLog = require("../model/anticheat.js");
const Bans = require("../model/bans.js");
const User = require("../model/user.js");
const log = require("./log.js");

class AnticheatSystem {
    constructor() {
        this.thresholds = {
            warning: 3,
            tempBan: 5,
            permBan: 10
        };

        this.playerStats = new Map();
        this.movementTracking = new Map();
        this.killTracking = new Map();
    }

    async logViolation(accountId, username, violationType, severity, details = {}, gameSession = null) {
        try {
            const violation = await AnticheatLog.create({
                accountId,
                username,
                violationType,
                severity,
                detectedAt: new Date(),
                gameSession,
                details,
                actionTaken: "none",
                resolved: false
            });

            log.anticheat(`${username} (${accountId}) - ${violationType} detected (Severity: ${severity})`);

            const violationCount = await AnticheatLog.countDocuments({
                accountId,
                resolved: false,
                detectedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            });

            let action = "none";

            if (severity >= 9 || violationCount >= this.thresholds.permBan) {
                action = "permanent_ban";
                await this.banPlayer(accountId, username, "permanent", "Anticheat: Multiple violations detected", null);
            } else if (severity >= 7 || violationCount >= this.thresholds.tempBan) {
                action = "temp_ban";
                const banDuration = 24 * 60 * 60 * 1000;
                await this.banPlayer(accountId, username, "matchmaking", "Anticheat: Suspicious activity", new Date(Date.now() + banDuration));
            } else if (violationCount >= this.thresholds.warning) {
                action = "warning";
                log.anticheat(`Warning issued to ${username}`);
            }

            await violation.updateOne({ $set: { actionTaken: action } });

            if (severity >= 7) {
                this.kickPlayer(accountId);
            }

            return { violation, action, violationCount };
        } catch (err) {
            log.error(`Error logging violation: ${err.message}`);
            return null;
        }
    }

    async banPlayer(accountId, username, banType, reason, expiresAt) {
        try {
            const existingBan = await Bans.findOne({
                accountId,
                isActive: true,
                $or: [
                    { expiresAt: null },
                    { expiresAt: { $gt: new Date() } }
                ]
            });

            if (existingBan) {
                log.anticheat(`${username} is already banned`);
                return existingBan;
            }

            const ban = await Bans.create({
                accountId,
                username,
                banType,
                reason,
                bannedBy: "Anticheat System",
                bannedAt: new Date(),
                expiresAt,
                isActive: true,
                metadata: {
                    automatic: true,
                    source: "anticheat"
                }
            });

            if (banType === "permanent") {
                await User.updateOne({ accountId }, { $set: { banned: true } });
            }

            this.kickPlayer(accountId);

            log.anticheat(`${username} banned (${banType}) - ${reason}`);
            return ban;
        } catch (err) {
            log.error(`Error banning player: ${err.message}`);
            return null;
        }
    }

    async isPlayerBanned(accountId, banType = null) {
        try {
            const query = {
                accountId,
                isActive: true,
                $or: [
                    { expiresAt: null },
                    { expiresAt: { $gt: new Date() } }
                ]
            };

            if (banType) {
                query.banType = banType;
            }

            const ban = await Bans.findOne(query);
            return ban;
        } catch (err) {
            log.error(`Error checking ban: ${err.message}`);
            return null;
        }
    }

    kickPlayer(accountId) {
        try {
            if (global.Clients && Array.isArray(global.Clients)) {
                const xmppClient = global.Clients.find(client => client.accountId === accountId);
                if (xmppClient && xmppClient.client) {
                    xmppClient.client.close();
                    log.anticheat(`Kicked player ${accountId} from XMPP`);
                }
            }

            if (global.accessTokens) {
                const tokenIndex = global.accessTokens.findIndex(t => t.accountId === accountId);
                if (tokenIndex !== -1) {
                    global.accessTokens.splice(tokenIndex, 1);
                }
            }

            if (global.refreshTokens) {
                const refreshIndex = global.refreshTokens.findIndex(t => t.accountId === accountId);
                if (refreshIndex !== -1) {
                    global.refreshTokens.splice(refreshIndex, 1);
                }
            }

            return true;
        } catch (err) {
            log.error(`Error kicking player: ${err.message}`);
            return false;
        }
    }

    trackMovement(accountId, position, velocity, timestamp) {
        if (!this.movementTracking.has(accountId)) {
            this.movementTracking.set(accountId, []);
        }

        const history = this.movementTracking.get(accountId);
        history.push({ position, velocity, timestamp });

        if (history.length > 100) {
            history.shift();
        }

        if (history.length >= 3) {
            const recent = history.slice(-3);
            const avgSpeed = this.calculateAverageSpeed(recent);

            const MAX_SPEED = 2000;
            if (avgSpeed > MAX_SPEED) {
                return { suspicious: true, type: "speed_hack", value: avgSpeed };
            }

            if (this.detectTeleport(recent)) {
                return { suspicious: true, type: "teleport" };
            }

            if (this.detectFlyHack(recent)) {
                return { suspicious: true, type: "fly_hack" };
            }
        }

        return { suspicious: false };
    }

    calculateAverageSpeed(positions) {
        if (positions.length < 2) return 0;

        let totalSpeed = 0;
        for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1];
            const curr = positions[i];
            const timeDiff = (curr.timestamp - prev.timestamp) / 1000;

            if (timeDiff > 0 && prev.position && curr.position) {
                const distance = Math.sqrt(
                    Math.pow(curr.position.x - prev.position.x, 2) +
                    Math.pow(curr.position.y - prev.position.y, 2) +
                    Math.pow(curr.position.z - prev.position.z, 2)
                );
                totalSpeed += distance / timeDiff;
            }
        }

        return totalSpeed / (positions.length - 1);
    }

    detectTeleport(positions) {
        if (positions.length < 2) return false;

        const last = positions[positions.length - 1];
        const prev = positions[positions.length - 2];

        if (!last.position || !prev.position) return false;

        const distance = Math.sqrt(
            Math.pow(last.position.x - prev.position.x, 2) +
            Math.pow(last.position.y - prev.position.y, 2) +
            Math.pow(last.position.z - prev.position.z, 2)
        );

        const timeDiff = (last.timestamp - prev.timestamp) / 1000;

        return distance > 5000 && timeDiff < 0.1;
    }

    detectFlyHack(positions) {
        if (positions.length < 3) return false;

        let verticalVelocity = 0;
        for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1];
            const curr = positions[i];

            if (prev.position && curr.position) {
                const timeDiff = (curr.timestamp - prev.timestamp) / 1000;
                if (timeDiff > 0) {
                    verticalVelocity += (curr.position.z - prev.position.z) / timeDiff;
                }
            }
        }

        const avgVerticalVelocity = verticalVelocity / (positions.length - 1);
        return avgVerticalVelocity > 1000;
    }

    trackKill(killerAccountId, victimAccountId, distance, headshot, timestamp) {
        if (!this.killTracking.has(killerAccountId)) {
            this.killTracking.set(killerAccountId, {
                kills: [],
                headshotCount: 0,
                totalKills: 0,
                suspiciousKills: 0
            });
        }

        const stats = this.killTracking.get(killerAccountId);
        stats.kills.push({ victimAccountId, distance, headshot, timestamp });
        stats.totalKills++;

        if (headshot) {
            stats.headshotCount++;
        }

        if (stats.kills.length > 50) {
            stats.kills.shift();
        }

        const headshotPercentage = (stats.headshotCount / stats.totalKills) * 100;
        if (stats.totalKills >= 10 && headshotPercentage > 80) {
            stats.suspiciousKills++;
            return { suspicious: true, type: "aimbot", headshotPercentage };
        }

        if (distance > 300 && stats.kills.filter(k => k.distance > 300).length > 5) {
            stats.suspiciousKills++;
            return { suspicious: true, type: "esp_wallhack", avgDistance: distance };
        }

        if (stats.kills.length >= 3) {
            const recentKills = stats.kills.slice(-3);
            const timeSpan = recentKills[2].timestamp - recentKills[0].timestamp;
            if (timeSpan < 2000) {
                return { suspicious: true, type: "rapid_fire", timeSpan };
            }
        }

        return { suspicious: false };
    }

    async cleanupExpiredBans() {
        try {
            const result = await Bans.updateMany(
                {
                    isActive: true,
                    expiresAt: { $ne: null, $lte: new Date() }
                },
                {
                    $set: { isActive: false }
                }
            );

            if (result.modifiedCount > 0) {
                log.anticheat(`Cleaned up ${result.modifiedCount} expired bans`);
            }
        } catch (err) {
            log.error(`Error cleaning up bans: ${err.message}`);
        }
    }

    async getViolationHistory(accountId, days = 30) {
        try {
            const violations = await AnticheatLog.find({
                accountId,
                detectedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
            }).sort({ detectedAt: -1 });

            return violations;
        } catch (err) {
            log.error(`Error fetching violation history: ${err.message}`);
            return [];
        }
    }

    clearPlayerTracking(accountId) {
        this.movementTracking.delete(accountId);
        this.killTracking.delete(accountId);
        this.playerStats.delete(accountId);
    }
}

const anticheatSystem = new AnticheatSystem();

setInterval(() => {
    anticheatSystem.cleanupExpiredBans();
}, 60 * 60 * 1000);

module.exports = anticheatSystem;
