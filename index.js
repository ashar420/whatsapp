const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock;
let latestQR = "";
let connectionStatus = "Connecting...";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            latestQR = qr;
            connectionStatus = "Scan QR Code";
            console.log("New QR Received!");
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "Disconnected, reconnecting...";
            console.log('Connection closed, reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = "Connected Successfully!";
            latestQR = "";
            console.log('WhatsApp Connected Successfully!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            console.log("New Message:", msg.message?.conversation || msg.message?.extendedTextMessage?.text);
        }
    });
}

// Browser par QR code dikhane ke liye route
app.get('/', (req, res) => {
    if (connectionStatus === "Connected Successfully!") {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h1 style="color: green;">WhatsApp Connected Successfully! ✅</h1>
                <p>Aapka WhatsApp CRM ke sath successfully mirror ho chuka hai.</p>
            </div>
        `);
    }
    if (!latestQR) {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Status: ${connectionStatus}</h2>
                <p>QR code generate ho raha hai, page khud hi refresh hoga...</p>
                <script>setTimeout(() => window.location.reload(), 3000);</script>
            </div>
        `);
    }
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
    res.send(`
        <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
            <h2>WhatsApp CRM - Scan QR Code</h2>
            <p>Status: <b>${connectionStatus}</b></p>
            <img src="${qrApiUrl}" alt="WhatsApp QR Code" style="border: 2px solid #ccc; padding: 10px; border-radius: 10px;" />
            <p>Apna WhatsApp Business kholein (Linked Devices > Link a Device) aur yeh QR code scan karein.</p>
            <script>setTimeout(() => window.location.reload(), 5000);</script>
        </div>
    `);
});

// API endpoint to send message
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    try {
        const jid = phone.includes('@s.whatsapp.net') ? phone : `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, message: "Message sent!" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectToWhatsApp();
});
