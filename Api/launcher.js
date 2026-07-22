const express = require("express");
const app = express.Router();
const User = require("../model/user.js");
const log = require("../structs/log.js");
const bcrypt = require("bcrypt");
const matchmaker = require("../matchmaker/matchmaker.js");
const axios = require("axios");
const functions = require("../structs/functions.js");
const jwt = require("jsonwebtoken");

app.get("/api/launcher/exchange-code", async (req, res) => {
    let accountId;

    // Try JWT Bearer auth first (Stellar-style)
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
            const decoded = jwt.verify(token, global.JWT_SECRET);
            accountId = decoded.accountId;
        } catch (err) {
        }
    }

    // Fallback: accountId in query param
    if (!accountId) {
        accountId = req.query.accountId;
        if (!accountId) {
            return res.status(400).json({ error: 'Provide accountId in query param or authenticate via Bearer JWT.' });
        }
    }

    try {
        const user = await User.findOne({ accountId: accountId });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const exchange_code = functions.MakeID().replace(/-/ig, "");

        global.exchangeCodes.push({
            accountId: user.accountId,
            exchange_code: exchange_code,
            creatingClientId: "amethyst"
        });


        setTimeout(() => {
            let idx = global.exchangeCodes.findIndex(i => i.exchange_code == exchange_code);
            if (idx != -1) global.exchangeCodes.splice(idx, 1);
        }, 300000);

        return res.status(200).json({ code: exchange_code });
    } catch (err) {
        log.error('Exchange Code Error:', err.message);
        return res.status(500).json({ error: 'Failed to generate exchange code.' });
    }
});

//Api for launcher login (If u want a POST requesto just replace "app.get" to "app.post" and "req.query" to "req.body")
app.get("/api/launcher/login", async (req, res) => {
    const { email, password } = req.query;

    if (!email) return res.status(400).send('The email was not entered.');
    if (!password) return res.status(400).send('The password was not entered.');

    try {
        const user = await User.findOne({ email: email });
        if (!user) return res.status(404).send('User not found.');

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (passwordMatch) {
            const username = user.username;

            return res.status(200).json({
                username: username,
            });
        } else {
            return res.status(400).send('Error!');
        }
    } catch (err) {
        log.error('Launcher Api Error:', err);
        return res.status(500).send('Error encountered, look at the console');
    }
});

app.get("/api/launcher/status", (req, res) => {
    try {
        const onlineCount = global.Clients ? global.Clients.length : 0;

        const queueStatus = {};
        if (matchmaker.queue) {
            for (const [playlist, players] of matchmaker.queue) {
                queueStatus[playlist] = players.length;
            }
        }

        const totalQueued = Object.values(queueStatus).reduce((a, b) => a + b, 0);

        const activeMatchCount = matchmaker.activeSessions ? matchmaker.activeSessions.size : 0;

        res.json({
            status: "online",
            onlinePlayers: onlineCount,
            totalQueuedPlayers: totalQueued,
            queueByPlaylist: queueStatus,
            activeMatches: activeMatchCount,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        log.error("Launcher Status Error:", err);
        res.status(500).json({
            status: "error",
            onlinePlayers: 0,
            totalQueuedPlayers: 0,
            queueByPlaylist: {},
            activeMatches: 0,
            timestamp: new Date().toISOString()
        });
    }
});

app.put("/api/launcher/update-username", async (req, res) => {
    const { accountId, newUsername } = req.body;

    if (!accountId || !newUsername) {
        return res.status(400).json({ error: 'accountId and newUsername are required.' });
    }

    if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
    }

    try {
        const user = await User.findOne({ accountId: accountId });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        user.username = newUsername;
        user.username_lower = newUsername.toLowerCase();
        await user.save();

        return res.status(200).json({ success: true, username: newUsername });
    } catch (err) {
        log.error('Update Username Error:', err);
        return res.status(500).json({ error: 'Failed to update username.' });
    }
});

app.get("/api/launcher/discord-roles/:discordId", async (req, res) => {
    const { discordId } = req.params;

    if (!discordId) {
        return res.status(400).json({ error: 'discordId is required.' });
    }

    try {
        const config = JSON.parse(require('fs').readFileSync('./Config/config.json', 'utf8'));
        const botToken = config.discord.bot_token;
        const guildId = config.discord.guildId;

        if (!botToken || !guildId) {
            return res.status(500).json({ error: 'Bot token or guild ID not configured.' });
        }

        const rolesResponse = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${botToken}` }
        });

        let memberRoleIds = [];
        try {
            const memberResponse = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
                headers: { Authorization: `Bot ${botToken}` }
            });
            memberRoleIds = memberResponse.data.roles || [];
        } catch (memberErr) {
            log.error(`Member fetch failed for ${discordId}:`, memberErr.response ? memberErr.response.data : memberErr.message);
        }

        const allRoles = rolesResponse.data;
        const memberRoles = allRoles
            .filter(r => memberRoleIds.includes(r.id) && r.id !== '0')
            .sort((a, b) => b.position - a.position);

        if (memberRoles.length > 0) {
            const topRole = memberRoles[0];
            const colorInt = topRole.color || 0;
            return res.status(200).json({
                name: topRole.name,
                color: '#' + colorInt.toString(16).padStart(6, '0').toUpperCase()
            });
        }

        return res.status(200).json({ name: 'User', color: '#FFFFFF' });
    } catch (err) {
        log.error('Discord Roles Error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch Discord roles.' });
    }
});

app.get("/api/launcher/user-stats/:accountId", async (req, res) => {
    const { accountId } = req.params;

    if (!accountId) {
        return res.status(400).json({ error: 'accountId is required.' });
    }

    try {
        const UserStats = require("../model/userstats.js");
        const Profile = require("../model/profiles.js");

        const stats = await UserStats.findOne({ accountId });
        const profile = await Profile.findOne({ accountId });

        let totalKills = 0;
        let totalWins = 0;
        let totalMatches = 0;

        if (stats) {
            for (const mode of ['solo', 'duo', 'trio', 'squad', 'ltm']) {
                if (stats[mode]) {
                    totalKills += stats[mode].kills || 0;
                    totalWins += stats[mode].placetop1 || stats[mode].wins || 0;
                    totalMatches += stats[mode].matchesplayed || 0;
                }
            }
        }

        let vbucks = 0;
        if (profile && profile.profiles && profile.profiles['common_core']) {
            const mtxCurrency = profile.profiles['common_core'].items?.['MtxCurrency'];
            if (mtxCurrency && mtxCurrency.quantity) {
                vbucks = mtxCurrency.quantity;
            }
        }

        return res.status(200).json({
            vbucks,
            kills: totalKills,
            wins: totalWins,
            matchesPlayed: totalMatches
        });
    } catch (err) {
        log.error('User Stats Error:', err);
        return res.status(500).json({ error: 'Failed to fetch user stats.' });
    }
});

app.get("/api/launcher/caldera", async (req, res) => {
    let accountId;

    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
            const decoded = jwt.verify(token, global.JWT_SECRET);
            accountId = decoded.accountId;
        } catch (err) {
        }
    }

    if (!accountId) {
        accountId = req.query.accountId;
        if (!accountId) {
            return res.status(400).json({ error: 'Provide accountId in query param or authenticate via Bearer JWT.' });
        }
    }

    const { createCaldera } = require("../CalderaService/tokencreator");
    const caldera = createCaldera(accountId);

    res.status(200).json({ caldera: caldera });
});

module.exports = app;
