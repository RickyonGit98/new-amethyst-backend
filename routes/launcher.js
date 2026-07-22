const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../model/user.js");
const log = require("../structs/log.js");
const config = require("../Config/config.json");

router.post("/api/launcher/verify", async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token required" });

    try {
        const decoded = jwt.verify(token, global.JWT_SECRET);
        const user = await User.findOne({ accountId: decoded.accountId }).lean();
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json({
            discordId: decoded.discordId,
            accountId: decoded.accountId,
            username: decoded.username,
            email: decoded.email,
            avatar_url: decoded.avatar_url,
            role: decoded.role || { name: "User", color: "#FFFFFF" },
            favoriteSkin: decoded.favoriteSkin || "CID_028_Athena_Commando_F"
        });
    } catch (err) {
        log.error("Launcher verify error:", err.message);
        res.status(401).json({ message: "Invalid or expired token" });
    }
});

router.post("/api/account/username", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Authorization required" });
    }

    const token = authHeader.split(" ")[1];
    const { username } = req.body;

    if (!username || typeof username !== "string" || username.trim().length < 3) {
        return res.status(400).json({ message: "Username must be at least 3 characters" });
    }
    if (username.trim().length > 16) {
        return res.status(400).json({ message: "Username must be 16 characters or less" });
    }

    try {
        const decoded = jwt.verify(token, global.JWT_SECRET);

        const existing = await User.findOne({ username_lower: username.trim().toLowerCase() });
        if (existing && existing.accountId !== decoded.accountId) {
            return res.status(409).json({ message: "Username already taken" });
        }

        await User.updateOne(
            { accountId: decoded.accountId },
            { $set: { username: username.trim(), username_lower: username.trim().toLowerCase() } }
        );

        log.launcher(`Username changed: ${decoded.username} -> ${username.trim()} (${decoded.accountId})`);
        res.json({ message: "Username updated successfully", username: username.trim() });
    } catch (err) {
        log.error("Username change error:", err.message);
        res.status(401).json({ message: "Invalid or expired token" });
    }
});

module.exports = router;
