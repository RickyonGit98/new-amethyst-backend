var http = require('http');
const uuid = require("uuid");

const tokencreator = require("./tokencreator.js");
const log = require("../structs/log.js");

function calderaHandler(req, res) {
    let body = ''

    req.on('data', (chunk) => {
        body += chunk
    })

    req.on('end', function() {
        try{
            var json = JSON.parse(body)
            let caldera = tokencreator.createCaldera(json.account_id)
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            let payload = {
                "provider": "none",
                "jwt": caldera
            }
            res.end(JSON.stringify(payload))
        } catch (error) {
            log.error(error)
            res.status(400).json({ error: "invalid request" })
        }
    })
}

function createCalderaService() {
    const server = http.createServer(function (req, res) {
        calderaHandler(req, res)
    })

    return server;
}

module.exports = { createCalderaService, calderaHandler };