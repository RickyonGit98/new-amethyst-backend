const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../Config/config.json');
const log = require('../structs/log.js');

const router = express.Router();

router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const CATALOG_CONFIG_PATH = path.join(__dirname, '..', 'Config', 'catalog_config.json');

async function verifyAdminRole(discordId) {
    if (!discordId) return false;
    try {
        const botToken = config.discord.bot_token;
        const guildId = config.discord.guildId;

        const memberResponse = await axios.get(
            `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
            { headers: { Authorization: `Bot ${botToken}` } }
        );
        const memberRoleIds = memberResponse.data.roles || [];

        const rolesResponse = await axios.get(
            `https://discord.com/api/v10/guilds/${guildId}/roles`,
            { headers: { Authorization: `Bot ${botToken}` } }
        );
        const allRoles = rolesResponse.data;

        const userRoles = allRoles.filter(r => memberRoleIds.includes(r.id));
        return userRoles.some(r => {
            const name = r.name.toUpperCase();
            return name === 'OWNER' || name === 'CO-OWNER' || name === 'COOWNER';
        });
    } catch (err) {
        log.error('[Admin] Role verification failed:', err.message);
        return false;
    }
}

router.get('/api/admin/get-slots', (req, res) => {
    try {
        let catalogConfig = { "//": "BR Item Shop Config" };
        if (fs.existsSync(CATALOG_CONFIG_PATH)) {
            catalogConfig = JSON.parse(fs.readFileSync(CATALOG_CONFIG_PATH, 'utf8'));
        }

        const dailySlots = [];
        const featuredSlots = [];

        for (let i = 1; i <= config.bDailyItemsAmount; i++) {
            const key = `daily${i}`;
            dailySlots.push({
                slot: i,
                itemGrants: catalogConfig[key]?.itemGrants || [],
                price: catalogConfig[key]?.price || 0,
            });
        }

        for (let i = 1; i <= config.bFeaturedItemsAmount; i++) {
            const key = `featured${i}`;
            featuredSlots.push({
                slot: i,
                itemGrants: catalogConfig[key]?.itemGrants || [],
                price: catalogConfig[key]?.price || 0,
            });
        }

        res.json({ dailySlots, featuredSlots });
    } catch (err) {
        log.error('[Admin] Failed to load slots:', err.message);
        res.status(500).json({ error: 'Failed to load slots' });
    }
});

router.post('/api/admin/update-shop', async (req, res) => {
    try {
        const { discordId, dailySlots, featuredSlots } = req.body;

        const isAdmin = await verifyAdminRole(discordId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions. OWNER or CO-OWNER role required.' });
        }

        const catalogConfig = { "//": "BR Item Shop Config" };

        if (Array.isArray(dailySlots)) {
            dailySlots.forEach((slot) => {
                if (slot.itemGrants && slot.itemGrants.length > 0) {
                    catalogConfig[`daily${slot.slot}`] = {
                        itemGrants: slot.itemGrants,
                        price: slot.price || 0,
                    };
                }
            });
        }

        if (Array.isArray(featuredSlots)) {
            featuredSlots.forEach((slot) => {
                if (slot.itemGrants && slot.itemGrants.length > 0) {
                    catalogConfig[`featured${slot.slot}`] = {
                        itemGrants: slot.itemGrants,
                        price: slot.price || 0,
                    };
                }
            });
        }

        fs.writeFileSync(CATALOG_CONFIG_PATH, JSON.stringify(catalogConfig, null, 2), 'utf-8');
        log.backend('[Admin] Shop updated successfully by', discordId);

        res.json({ success: true, message: 'Shop updated successfully' });
    } catch (err) {
        log.error('[Admin] Failed to update shop:', err.message);
        res.status(500).json({ error: 'Failed to update shop' });
    }
});

module.exports = router;
