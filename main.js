require("dotenv").config()
const express = require("express")
const axios = require("axios")
const jwt = require("jsonwebtoken")

const { Client, GatewayIntentBits, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js")

const path = require("path")


const discordToken = process.env.DISCORDTOKEN
const channelId    = process.env.CHANNELID
const apiBaseUrl   = process.env.APIBASEURL
const jwtSecret    = process.env.JWTSECRET


// instanse
const client = new Client({
    intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
})

const app = express()
app.use(express.json({ extended: true, limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static("site"))
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))




// discord.js
client.on("ready", () => {
    console.log(`${client.user.tag} > ちっす。`)
})

async function sendMessageToDiscord(author, image, payload, text, isSpoiler) {
    const channel = await client.channels.fetch(channelId)
    if (!channel) return
    if (author == "null") author = "匿名"

    const quotebtn = new ButtonBuilder()
        .setCustomId("newbtn")
        .setLabel("新規作成")
        .setStyle(ButtonStyle.Primary)
    const newbtn = new ButtonBuilder()
        .setCustomId("quote")
        .setLabel("この画像を引用して送信")
        .setStyle(ButtonStyle.Danger)
    const row = new ActionRowBuilder().addComponents(quotebtn, newbtn)

    const sendmsg  = text ? `作者：${author}\n${text}` : `作者：${author}`
    const filename = isSpoiler ? "SPOILER_image.png" : "image.png"

    if (payload.imageUrl) {
        const rpmessage = await channel.messages.fetch(payload.msgid)
        rpmessage.reply({
            content: sendmsg,
            files: [new AttachmentBuilder(image, { name: filename })],
            components: [row],
        })
    } else {
        channel.send({
            content: sendmsg,
            files: [new AttachmentBuilder(image, { name: filename })],
            components: [row],
        })
    }
}

client.on("interactionCreate", async (message) => {
    try {
        const a     = message.user.globalName
        const msgid = message.message.id

        if (message.customId === "quote") {
            const attachUrl = message.message.attachments.first().url
            const token = jwt.sign({ author: a, msgid, imageUrl: attachUrl }, jwtSecret, { expiresIn: "1h" })

            const sendmsg = await message.reply({
                content: `15秒後に消えます\n${apiBaseUrl}?token=${token}`,
                ephemeral: true,
            })
            setTimeout(() => sendmsg.delete().catch(console.error), 15000)

        } else if (message.customId === "newbtn") {
            const token = jwt.sign({ author: a, msgid, imageUrl: null }, jwtSecret, { expiresIn: "1h" })

            const sendmsg = await message.reply({
                content: `15秒後に消えます\n${apiBaseUrl}?token=${token}`,
                ephemeral: true
            })
            setTimeout(() => sendmsg.delete().catch(console.error), 15000)
        }
    } catch (e) {
        console.error("interactionCreate error:", e)
        await message.reply({ content: "エラーが発生しました", ephemeral: true }).catch(() => {})
    }
})

client.login(discordToken)




// express
const allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE")
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, access_token")
    if ("OPTIONS" === req.method) {
        res.send(200)
    } else {
        next()
    }
}
app.use(allowCrossDomain)

app.get("/", function (req, res) {
    res.render("index", {
        apiBaseUrl: `<script>window.apiBaseUrl = "${apiBaseUrl}"</script>`,
    })
})

app.post("/submit", (req, res) => {
    const image_    = req.body.image
    const token     = req.body.token
    const text      = req.body.text
    const isAnonym  = req.body.anonym
    const isSpoiler = req.body.spoiler

    let payload
    try {
        payload = jwt.verify(token, jwtSecret)
    } catch (e) {
        payload = null
    }

    let author
    if (!payload) {
        author = "session over"
    } else if (isAnonym) {
        author = (Math.random() < 0.1) ? payload.author + "[匿名すり抜け発動]" : "匿名"
    } else {
        author = payload.author
    }

    if (!image_) return res.status(400).send("ぅゎ〜〜〜〜〜〜〜〜〜")

    const image = Buffer.from(image_.replace(/^data:image\/\w+;base64,/, ''), "base64")
    sendMessageToDiscord(author, image, payload ?? {}, text, isSpoiler)
    res.status(200).send("OK")
})

app.get("/inquiry", async (req, res) => {
    let payload
    try {
        payload = jwt.verify(req.query.token, jwtSecret)
    } catch (e) {
        return res.status(401).json({ error: "invalid token" })
    }

    if (!payload.imageUrl) return res.json({ base64img: null })

    try {
        const r = await axios.get(payload.imageUrl, { responseType: "arraybuffer" })
        const b64 = Buffer.from(r.data, "binary").toString("base64")
        res.json({ base64img: b64 })
    } catch (e) {
        res.status(502).json({ error: "failed to fetch image" })
    }
})

app.listen(3000, () => {
    console.log("Express server is running on port 3000")
})
