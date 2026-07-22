module.exports = function(websiteApp) {
    const express = require("express");
    const path = require("path");
    const config = require("../Config/config.json");

    const DISCORD_API_URL = 'https://discord.com/api';
    const CLIENT_ID = config.Website.clientId;
    const CLIENT_SECRET = config.Website.clientSecret;
    const REDIRECT_URI = config.Website.redirectUri.replace("${websiteport}", config.Website.websiteport);

    websiteApp.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    websiteApp.use(express.json());
    websiteApp.use(express.urlencoded({ extended: true }));
    
    websiteApp.use('/Images', express.static(path.join(__dirname, './Data/Images')));
    websiteApp.use('/css', express.static(path.join(__dirname, './Data/css')));
    websiteApp.use('/html', express.static(path.join(__dirname, './Data/html')));

    websiteApp.get('/', (req, res) => {
        res.redirect('/login');
    });

    websiteApp.get('/login', (req, res) => {
        const authURL = `${DISCORD_API_URL}/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;

        res.redirect(authURL);
    });

    const oauthCallback = require('./Data/js/oauthCallback')(DISCORD_API_URL, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    websiteApp.get('/oauth2/callback', oauthCallback);

    const launcherOAuth = require('./Data/js/launcherOAuth')(DISCORD_API_URL, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    websiteApp.use('/', launcherOAuth);

    websiteApp.post('/register-user', require('./Data/js/registerUser.js'));

    let shopCache = null;
    let shopCacheTime = 0;
    const SHOP_CACHE_TTL = 300000; // 5 min

    async function fetchCosmeticWithTimeout(cosmeticId, timeoutMs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`https://fortnite-api.com/v2/cosmetics/br/${cosmeticId}`, { signal: controller.signal });
            if (!res.ok) return null;
            const json = await res.json();
            return json.data;
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    websiteApp.get('/api/fortnite/shop', async (req, res) => {
        try {
            if (shopCache && Date.now() - shopCacheTime < SHOP_CACHE_TTL) {
                return res.json(shopCache);
            }

            const catalogRes = await fetch('http://127.0.0.1:3551/fortnite/api/storefront/v2/catalog');
            const catalog = await catalogRes.json();

            const rawEntries = [];
            if (catalog.storefronts) {
                for (const storefront of catalog.storefronts) {
                    for (const entry of storefront.catalogEntries || []) {
                        const section = entry.meta?.SectionId || 'Featured';
                        const price = (entry.prices && entry.prices[0]) ? entry.prices[0].finalPrice : 0;
                        const idParts = (entry.itemGrants && entry.itemGrants[0]) ? entry.itemGrants[0].templateId.split(':') : [];
                        const cosmeticId = idParts.length > 1 ? idParts[1] : (idParts[0] || null);
                        if (!cosmeticId) continue;
                        rawEntries.push({ cosmeticId, price, section });
                    }
                }
            }

            const cosmeticIds = [...new Set(rawEntries.map(e => e.cosmeticId))];
            const cosResults = await Promise.allSettled(
                cosmeticIds.map(id => fetchCosmeticWithTimeout(id, 5000))
            );
            const cosMap = {};
            cosmeticIds.forEach((id, i) => {
                if (cosResults[i].status === 'fulfilled' && cosResults[i].value) {
                    cosMap[id] = cosResults[i].value;
                }
            });

            const seenIds = new Set();
            const entries = [];
            for (const raw of rawEntries) {
                if (seenIds.has(raw.cosmeticId)) continue;
                seenIds.add(raw.cosmeticId);
                const cd = cosMap[raw.cosmeticId];
                entries.push({
                    id: raw.cosmeticId,
                    name: cd?.name || raw.cosmeticId,
                    type: cd?.type?.displayValue || 'Unknown',
                    typeValue: cd?.type?.value || '',
                    rarity: cd?.rarity?.value || 'common',
                    rarityDisplay: cd?.rarity?.displayValue || 'Common',
                    icon: cd?.images?.icon || '',
                    finalPrice: raw.price,
                    section: raw.section,
                });
            }

            shopCache = { entries };
            shopCacheTime = Date.now();
            res.json({ entries });
        } catch (err) {
            console.error('Failed to fetch shop:', err);
            if (shopCache) return res.json(shopCache);
            res.status(502).json({ error: 'Failed to fetch shop data' });
        }
    });

    websiteApp.get('/register', (req, res) => {
        res.sendFile(path.join(__dirname, './Data/html/register.html'));
    });

    websiteApp.get('/account-exists', (req, res) => {
        res.sendFile(path.join(__dirname, './Data/html/accountExists.html'));
    });
};
