const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const log = require('../../../structs/log.js');
const User = require('../../../model/user.js');
const Profile = require('../../../model/profiles.js');
const Friends = require('../../../model/friends.js');
const profileManager = require('../../../structs/profile.js');
const functions = require('../../../structs/functions');

let pendingToken = null;

module.exports = (DISCORD_API_URL, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) => {
    const router = require('express').Router();
    const LAUNCHER_REDIRECT_URI = REDIRECT_URI.replace('/oauth2/callback', '/launcher/callback');

    router.get('/launcher/approve', (req, res) => {
        const token = req.query.token;
        if (!token) return res.status(400).json({ error: 'Token required' });
        pendingToken = token;
        res.json({ success: true });
    });

    router.get('/launcher/consume-pending', (req, res) => {
        const token = pendingToken;
        pendingToken = null;
        res.json({ token });
    });

    router.get('/launcher/login', (req, res) => {
        // Se añade 'email' al scope (separado por %20 mediante encodeURIComponent)
        const authURL = `${DISCORD_API_URL}/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(LAUNCHER_REDIRECT_URI)}&response_type=code&scope=identify`;
        res.redirect(authURL);
    });

    router.get('/launcher/callback', async (req, res) => {
        const code = req.query.code;

        if (!code) {
            return res.status(400).send('No code provided');
        }

        try {
            const tokenResponse = await axios.post(`${DISCORD_API_URL}/oauth2/token`, new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: LAUNCHER_REDIRECT_URI,
                scope: 'identify email' // Se actualiza el scope aquí también
            }));

            const accessToken = tokenResponse.data.access_token;

            const userResponse = await axios.get(`${DISCORD_API_URL}/users/@me`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            const discordId = userResponse.data.id;
            const username = userResponse.data.username;
            // Al tener el scope 'email', userResponse.data.email ahora traerá el correo real de Discord
            const email = userResponse.data.email || `${username}@amethyst.dev`;
            const avatarId = userResponse.data.avatar;
            const avatar_url = avatarId
                ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarId}.png?size=1024`
                : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId) % 5}.png`;

            let highestRole = { name: 'User', color: '#FFFFFF' };

            try {
                const config = JSON.parse(require('fs').readFileSync('./Config/config.json', 'utf8'));
                const botToken = config.discord.bot_token;
                const guildId = config.discord.guildId;
                console.log(`[Roles] Config: guildId=${guildId}, botToken=${botToken ? botToken.substring(0, 20) + '...' : 'MISSING'}, discordId=${discordId}`);

                if (botToken && guildId && discordId) {
                    let rolesResponse;
                    try {
                        rolesResponse = await axios.get(`${DISCORD_API_URL}/v10/guilds/${guildId}/roles`, {
                            headers: { Authorization: `Bot ${botToken}` }
                        });
                        console.log(`[Roles] Roles fetch OK: ${rolesResponse.data.length} roles`);
                    } catch (rolesErr) {
                        console.log(`[Roles] Roles fetch FAILED: ${rolesErr.response ? rolesErr.response.status : rolesErr.message}`);
                        if (rolesErr.response && rolesErr.response.data) {
                            console.log('[Roles] Response:', JSON.stringify(rolesErr.response.data));
                        }
                        throw rolesErr;
                    }

                    let memberRoleIds = [];
                    try {
                        const memberResponse = await axios.get(`${DISCORD_API_URL}/v10/guilds/${guildId}/members/${discordId}`, {
                            headers: { Authorization: `Bot ${botToken}` }
                        });
                        memberRoleIds = memberResponse.data.roles || [];
                        console.log(`[Roles] Member fetch OK: roles=${JSON.stringify(memberRoleIds)}`);
                    } catch (memberErr) {
                        console.log(`[Roles] Member fetch FAILED: ${memberErr.response ? memberErr.response.status : memberErr.message}`);
                        if (memberErr.response && memberErr.response.data) {
                            console.log('[Roles] Response:', JSON.stringify(memberErr.response.data));
                        }
                    }

                    const allRoles = rolesResponse.data;
                    const memberRoles = allRoles
                        .filter(r => memberRoleIds.includes(r.id) && r.id !== '0')
                        .sort((a, b) => b.position - a.position);

                    if (memberRoles.length > 0) {
                        const topRole = memberRoles[0];
                        highestRole.name = topRole.name;
                        if (topRole.color) {
                            const colorInt = topRole.color;
                            highestRole.color = '#' + colorInt.toString(16).padStart(6, '0').toUpperCase();
                        }
                    } else {
                        console.log(`[Roles] No roles found for user ${discordId}. memberRoleIds:`, memberRoleIds);
                    }
                }
            } catch (err) {
                console.log('Could not fetch Discord roles:', err.message);
            }

            let user = await User.findOne({ discordId: discordId });

            if (!user) {
                // Use discordId as base for a known password so users can login from ingame
                const plainPassword = `amethyst_${discordId}`;
                const hashedPassword = await bcrypt.hash(plainPassword, 10);
                const accountId = functions.MakeID().replace(/-/ig, '');
                const matchmakingId = functions.MakeID().replace(/-/ig, '');

                user = await User.create({
                    created: new Date().toISOString(),
                    discordId,
                    accountId,
                    username,
                    username_lower: username.toLowerCase(),
                    email,
                    password: hashedPassword,
                    matchmakingId
                });

                await Profile.create({ created: user.created, accountId: user.accountId, profiles: profileManager.createProfiles(user.accountId) });
                await Friends.create({ created: user.created, accountId: user.accountId });
                profileManager.createUserStatsProfiles(user.accountId);
            }

            const tokenPayload = {
                username: user.username,
                accountId: user.accountId,
                email: user.email,
                password: user.password,
                avatar_url: avatar_url,
                discordId: discordId,
                favoriteSkin: 'CID_028_Athena_Commando_F',
                role: highestRole
            };

            const token = jwt.sign(tokenPayload, global.JWT_SECRET, { expiresIn: '24h' });

            const WEBSITEPORT = require('../../../Config/config.json').Website.websiteport;
            res.redirect(`http://127.0.0.1:${WEBSITEPORT}/html/launcher-success.html?token=${encodeURIComponent(token)}&username=${encodeURIComponent(user.username)}&avatar=${encodeURIComponent(avatar_url)}`);

        } catch (err) {
            log.error('Launcher OAuth Error:', err);
            res.status(500).send('Authentication failed');
        }
    });

    return router;
};