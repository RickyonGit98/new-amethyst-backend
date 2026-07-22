const { Client, Intents, MessageEmbed } = require("discord.js");
const fs = require("fs");
const path = require("path");

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MEMBERS,
        Intents.FLAGS.GUILD_BANS,
        Intents.FLAGS.DIRECT_MESSAGES
    ],
    partials: ["CHANNEL"]
});

const config = JSON.parse(fs.readFileSync("./Config/config.json", "utf8"));
const log = require("../structs/log.js");
const Users = require("../model/user.js");
const functions = require("../structs/functions.js");

/* ================= READY ================= */

client.once("ready", () => {
    global.botClient = client;
    log.bot("Backend is online");

    if (config.bEnableBackendStatus) {
        if (!config.bBackendStatusChannelId || config.bBackendStatusChannelId.trim() === "") {
            log.error("bBackendStatusChannelId not set in config.json");
        } else {
            const channel = client.channels.cache.get(config.bBackendStatusChannelId);
            if (!channel) {
                log.error(`Channel ${config.bBackendStatusChannelId} not found`);
            } else {
                const embed = new MessageEmbed()
                    .setTitle("Backend Online")
                    .setDescription("The backend is now running")
                    .setColor("GREEN");

                channel.send({ embeds: [embed] }).catch(err => log.error(err));
            }
        }
    }

    if (config.discord?.bEnableInGamePlayerCount) {
        const updateBotStatus = () => {
            if (Array.isArray(global.Clients)) {
                client.user.setActivity(
                    `${global.Clients.length} player(s)`,
                    { type: "WATCHING" }
                );
            }
        };

        updateBotStatus();
        setInterval(updateBotStatus, 10000);
    }

    const commands = client.application.commands;

    const loadCommands = (dir) => {
        for (const file of fs.readdirSync(dir)) {
            const filePath = path.join(dir, file);
            if (fs.lstatSync(filePath).isDirectory()) {
                loadCommands(filePath);
            } else if (file.endsWith(".js")) {
                const command = require(filePath);
                if (command.commandInfo) {
                    commands.create(command.commandInfo);
                }
            }
        }
    };

    loadCommands(path.join(__dirname, "commands"));
});

/* ================= SLASH COMMANDS ================= */

client.on("interactionCreate", async interaction => {
    if (!interaction.isApplicationCommand()) return;

    const executeCommand = async (dir, name) => {
        const file = path.join(dir, `${name}.js`);
        if (fs.existsSync(file)) {
            try {
                await require(file).execute(interaction);
            } catch (err) {
                log.error(`Command ${name} failed: ${err.message}`);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
                }
            }
            return true;
        }

        for (const sub of fs.readdirSync(dir)) {
            const subPath = path.join(dir, sub);
            if (fs.lstatSync(subPath).isDirectory()) {
                if (await executeCommand(subPath, name)) return true;
            }
        }
        return false;
    };

    await executeCommand(path.join(__dirname, "commands"), interaction.commandName);
});

/* ================= CROSS BANS ================= */

client.on("guildBanAdd", async ban => {
    if (!config.bEnableCrossBans) return;

    const memberBan = await ban.fetch();
    if (memberBan.user.bot) return;

    const userData = await Users.findOne({ discordId: memberBan.user.id });
    if (!userData || userData.banned === true) return;

    await userData.updateOne({ $set: { banned: true } });

    const refreshToken = global.refreshTokens?.findIndex(i => i.accountId === userData.accountId);
    if (refreshToken > -1) global.refreshTokens.splice(refreshToken, 1);

    const accessToken = global.accessTokens?.findIndex(i => i.accountId === userData.accountId);
    if (accessToken > -1) {
        global.accessTokens.splice(accessToken, 1);
        const xmppClient = global.Clients?.find(c => c.accountId === userData.accountId);
        if (xmppClient) xmppClient.client.close();
    }

    if (accessToken > -1 || refreshToken > -1) {
        await functions.UpdateTokens();
    }

    log.debug(`user ${memberBan.user.username} (ID: ${memberBan.user.id}) banned in discord and game`);
});

client.on("guildBanRemove", async ban => {
    if (!config.bEnableCrossBans) return;
    if (ban.user.bot) return;

    const userData = await Users.findOne({ discordId: ban.user.id });
    if (userData?.banned === true) {
        await userData.updateOne({ $set: { banned: false } });
        log.debug(`User ${ban.user.username} (ID: ${ban.user.id}) unbanned`);
    }
});

/* ================= ANTICRASH ================= */

client.on("error", err => log.error(`Discord API: ${err.message}`));
process.on("unhandledRejection", (reason) => log.error(`Unhandled Rejection: ${reason}`));
process.on("uncaughtException", (err) => log.error(`Uncaught Exception: ${err.message}`));

/* ================= LOGIN ================= */

if (!config.discord?.bot_token || typeof config.discord.bot_token !== "string") {
    log.error("Bot token missing or invalid in config.json");
    process.exit(1);
}

client.login(config.discord.bot_token);
