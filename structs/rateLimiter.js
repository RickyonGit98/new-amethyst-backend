const config = require("../Config/config.json");

class RateLimiter {
    constructor() {
        this.store = new Map();
        this.windowMs = 30 * 1000;
        this.globalMax = 55;
        this.userLimits = {
            default: { max: 55, windowMs: 30000 },
            matchmaking: { max: 10, windowMs: 30000 },
            auth: { max: 20, windowMs: 30000 },
            friends: { max: 30, windowMs: 30000 },
            xmpp: { max: 50, windowMs: 30000 },
            storefront: { max: 15, windowMs: 30000 }
        };

        setInterval(() => this.cleanup(), 60000);
    }

    getKey(req) {
        const userId = req.user ? req.user.accountId : null;
        const ip = req.ip || req.connection.remoteAddress;
        return userId ? `user:${userId}` : `ip:${ip}`;
    }

    getLimit(req) {
        const url = req.url || "";
        if (url.includes("/matchmaking")) return this.userLimits.matchmaking;
        if (url.includes("/auth") || url.includes("/token")) return this.userLimits.auth;
        if (url.includes("/friends")) return this.userLimits.friends;
        if (url.includes("/storefront")) return this.userLimits.storefront;
        return this.userLimits.default;
    }

    check(req, res, next) {
        const key = this.getKey(req);
        const limit = this.getLimit(req);
        const now = Date.now();

        let entry = this.store.get(key);
        if (!entry || (now - entry.windowStart) > limit.windowMs) {
            entry = { count: 0, windowStart: now };
            this.store.set(key, entry);
        }

        entry.count++;

        const remaining = Math.max(0, limit.max - entry.count);
        const resetTime = entry.windowStart + limit.windowMs;

        res.set("X-RateLimit-Limit", limit.max.toString());
        res.set("X-RateLimit-Remaining", remaining.toString());
        res.set("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

        if (entry.count > limit.max) {
            const retryAfter = Math.ceil((resetTime - now) / 1000);
            res.set("Retry-After", retryAfter.toString());
            res.set("X-RateLimit-Remaining", "0");

            return res.status(429).json({
                "errorCode": "errors.com.epicgames.common.rate_limited",
                "errorMessage": "Too many requests. Please try again later.",
                "messageVars": [],
                "numericErrorCode": 1041,
                "error": "too_many_requests",
                "originatingService": "any",
                "intent": "prod",
                "error_description": `Rate limit exceeded. Retry after ${retryAfter} seconds.`
            });
        }

        next();
    }

    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            const limit = this.userLimits.default;
            if ((now - entry.windowStart) > limit.windowMs * 2) {
                this.store.delete(key);
            }
        }
    }

    getStats() {
        let activeWindows = 0;
        let totalRequests = 0;
        for (const [, entry] of this.store) {
            activeWindows++;
            totalRequests += entry.count;
        }
        return { activeWindows, totalRequests, storeSize: this.store.size };
    }
}

const limiter = new RateLimiter();

function perUserRateLimit(req, res, next) {
    return limiter.check(req, res, next);
}

module.exports = perUserRateLimit;
module.exports.RateLimiter = limiter;
