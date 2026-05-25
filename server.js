const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

/* MIDDLEWARE */
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* DATABASE CONNECTION (Cloud Hosted DB) */
const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_NAME || "bingo",
    port: process.env.DB_PORT || 3309,
    ssl: { rejectUnauthorized: false } // Cloud MySQL ချိတ်ဖို့အတွက် ဒါလေး သေချာပေါက် ပါရပါမယ်
});

/* CONNECT DATABASE */
db.connect((err) => {
    if (err) {
        console.log("Database Connection Failed");
        console.log(err);
    } else {
        console.log("MySQL Connected");
    }
});

/* 🎰 BINGO GAME STATE (SERVER-SIDE MEMORY) */
let playerSockets = new Set();
let gameHistory = [];
let currentSessionLabel = "1";
let bingoInterval = null;
const TOTAL_NUMBERS = 75;

// 🎲 ဆာဗာဘက်ကနေ Random နံပါတ်ထုတ်ပေးမယ့် စနစ်
function serverGenerateBingoNumber() {
    if (gameHistory.length >= TOTAL_NUMBERS) {
        if (bingoInterval) clearInterval(bingoInterval);
        io.emit("gameFinished", { message: "All numbers called!" });
        console.log("🎰 Game Over: All 75 Bingo numbers have been generated.");
        return;
    }

    let randomNumber;
    do {
        randomNumber = Math.floor(Math.random() * TOTAL_NUMBERS) + 1;
    } while (gameHistory.includes(randomNumber));

    gameHistory.push(randomNumber);

    console.log(`🎲 [SERVER SIDE] Random Number Generated: >> ${randomNumber} << (Total: ${gameHistory.length}/75)`);

    io.emit("gameUpdate", {
        history: gameHistory,
        currentNumber: randomNumber,
        sessionLabel: currentSessionLabel
    });
}

/* 🌐 REAL-TIME SOCKET.IO EVENT HANDLERS */
io.on("connection", (socket) => {
    console.log(`👤 [SERVER SIDE] New Connection: ${socket.id}`);

    socket.on("registerAsPlayer", () => {
        playerSockets.add(socket.id);
        console.log(`👤 [SERVER SIDE] A player joined. Current Live Count: ${playerSockets.size}`);
        io.emit("updatePlayerCount", playerSockets.size);
    });

    socket.emit("gameUpdate", {
        history: gameHistory,
        currentNumber: gameHistory[gameHistory.length - 1] || "--",
        sessionLabel: currentSessionLabel
    });

    io.emit("updatePlayerCount", playerSockets.size);

    socket.on("startGameLoop", (data) => {
        if (bingoInterval) clearInterval(bingoInterval);
        // Host ဆီက ပါလာတဲ့ sessionLabel ကို ဆာဗာမှာ သိမ်းလိုက်ခြင်း
        if (data && data.sessionLabel) {
            currentSessionLabel = data.sessionLabel;
        }

        console.log(`🏁 [SERVER SIDE] Host activated 'Go!' for Session: ${currentSessionLabel}`);

        serverGenerateBingoNumber();

        // ထိုနောက် ၁၀ စက္ကန့်ပြည့်တိုင်း နောက်ထပ် Random နံပါတ်များကို အလိုအလျောက် ဆက်ထုတ်ပေးမည်
        bingoInterval = setInterval(() => {
            serverGenerateBingoNumber();
        }, 10000); // 10000 ms = 10 Seconds
    });

    socket.on("playerBingo", (data) => {
        const { winnerName, userid } = data;

        if (bingoInterval) {
            clearInterval(bingoInterval);
            bingoInterval = null;
            console.log("⏸️ [SERVER SIDE] Bingo claimed! Interval paused.");
        }

        console.log(`🏆 [SERVER SIDE] BINGO CLAIMS! Winner: ${winnerName} (Database ID: ${userid})`);

        // အခြား player များဆီသို့ winner ရဲ့ အချက်အလက်များ လှမ်းပို့ပေးခြင်း
        io.emit("announceWinner", {
            winnerId: socket.id,
            winnerDbId: userid,
            winnerName: winnerName
        });
    });

    socket.on("resumeGameFromHost", () => {
        if (bingoInterval) clearInterval(bingoInterval);
        console.log("▶️ [SERVER SIDE] Host clicked OK. Resuming 10-second automatic interval...");
        io.emit("gameResume");

        serverGenerateBingoNumber();
        bingoInterval = setInterval(() => {
            serverGenerateBingoNumber();
        }, 10000);
    });

    // 🌟 ဒိုင်လူကြီးက ပွဲသိမ်းပြီး Restart Game ခလုပ်နှိပ်လိုက်လျှင် (ရှုံးသူများအား Home သို့ မောင်းထုတ်မည့် Socket Trigger)
    socket.on("resetGame", (data) => {
        if (bingoInterval) clearInterval(bingoInterval);
        gameHistory = [];
        
        // Host ဆီက နောက် Session ပေးလိုက်ရင် ပြောင်းပေးမယ် (ဥပမာ- "2")
        if (data && data.nextSession) {
            currentSessionLabel = String(data.nextSession);
        }
        
        console.log(`🔄 [SERVER SIDE] Game reset by Host. Next Session will be: ${currentSessionLabel}`);
        
        // နံပါတ်အဟောင်းတွေ ရှင်းပစ်ရန်
        io.emit("gameUpdate", { history: gameHistory, currentNumber: "--", sessionLabel: currentSessionLabel });
        
        // 🚨 Bingo မပေါက်ဘဲ ကျန်ခဲ့တဲ့လူတွေအကုန်လုံးကို Home (Index 0) သို့ ချက်ချင်း ပြန်ကန်ထုတ်ခိုင်းမည့် Event
        io.emit("gameResetByHost", { nextSession: currentSessionLabel });
    });

    socket.on("disconnect", () => {
        if (playerSockets.has(socket.id)) {
            playerSockets.delete(socket.id);
        }
        console.log(`❌ [SERVER SIDE] A connection left. Active Tracking Count: ${playerSockets.size}`);
        io.emit("updatePlayerCount", playerSockets.size);
    });
});

/* --- DATABASE REST APIs --- */

// 🔴 REGISTER ENDPOINT
app.post("/register", (req, res) => {
    const { username, userph, useremail, userage, useroccup } = req.body;

    const checkSql = "SELECT * FROM usertbl WHERE userph = ?";
    db.query(checkSql, [userph], (checkErr, checkResult) => {
        if (checkErr) return res.status(500).send({ success: false, message: "Database Error during validation" });
        if (checkResult.length > 0) return res.send({ success: false, message: "Phone number already exists" });

        const insertSql = `INSERT INTO usertbl (username, userph, useremail, userage, useroccup) VALUES (?, ?, ?, ?, ?)`;
        db.query(insertSql, [username, userph, useremail, userage, useroccup], (err, result) => {
            if (err) {
                res.status(500).send({ success: false, message: "Database Error during insertion" });
            } else {
                res.status(200).send({ success: true, redirect: "login.html" });
            }
        });
    });
});

// 🔴 LOGIN ENDPOINT
app.post('/api/login', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "ဖုန်းနံပါတ် ထည့်သွင်းပါ" });

    const sql = "SELECT userid, username, userph, useremail, userage, useroccup FROM usertbl WHERE userph = ?";
    db.query(sql, [phone], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: "Database error" });
        if (results.length > 0) {
            res.json({
                success: true,
                message: "Login successful",
                user: {
                    id: results[0].userid,
                    userid: results[0].userid,
                    name: results[0].username,
                    username: results[0].username,
                    userph: results[0].userph,
                    useremail: results[0].useremail,
                    userage: results[0].userage,
                    useroccup: results[0].useroccup
                }
            });
        } else {
            res.json({ success: false, message: "ဖုန်းနံပါတ် မှားယွင်းနေပါသည် သို့မဟုတ် အကောင့်မရှိပါ။" });
        }
    });
});

// 🔴 STAMP VERIFY ENDPOINT
app.post("/api/verify-stampcode", (req, res) => {
    const { stampCode, userph } = req.body;
    if (!stampCode || !userph) return res.status(400).send({ success: false, message: "Missing required inputs" });

    const findStampSql = "SELECT * FROM stamptable WHERE BINARY stampcode = ? LIMIT 1";

    db.query(findStampSql, [stampCode], (stampErr, stampResult) => {
        if (stampErr || stampResult.length === 0) {
            return res.status(404).send({ success: false, message: "Invalid or used Code." });
        }

        const newStampName = stampResult[0].stampname;
        const findUserSql = "SELECT stamprecord FROM usertbl WHERE userph = ? LIMIT 1";
        db.query(findUserSql, [userph], (userErr, userResult) => {
            if (userErr || userResult.length === 0) return res.status(444).send({ success: false, message: "Account not found." });

            let currentRecord = userResult[0].stamprecord;
            let existingStamps = currentRecord ? currentRecord.split(',').map(item => item.trim()) : [];

            if (existingStamps.includes(newStampName)) {
                return res.status(400).send({ success: false, message: `You already claimed this stamp type (${newStampName}).` });
            }

            let updatedRecordString = !currentRecord ? newStampName : `${currentRecord},${newStampName}`;
            const updateUserSql = "UPDATE usertbl SET stamprecord = ? WHERE userph = ?";
            db.query(updateUserSql, [updatedRecordString, userph], (updateErr) => {
                if (updateErr) return res.status(500).send({ success: false, message: "Update failed." });

                const deleteStampSql = "DELETE FROM stamptable WHERE BINARY stampcode = ?";
                db.query(deleteStampSql, [stampCode], () => {
                    return res.status(200).send({ success: true, message: "Stamp verified and processed!" });
                });
            });
        });
    });
});

// 🎰 SPIN/WHEEL API (လူ ၂၀ စစ်ဆေးချက်ကို သားကြီးရဲ့ Logic အတိုင်း သေသေချာချာ ပြန်ဖွင့်ထားပါသည်)
app.post('/api/spin', async (req, res) => { 
    const { userid, sessionid } = req.body;
    if (!userid || !sessionid) return res.status(400).json({ status: 'error', message: 'User ID နှင့် Session ID လိုအပ်ပါသည်!' });

    const finalSessionStr = String(sessionid);

    try {
        // 🌟 ၁။ [ပြန်ဖွင့်ပေးလိုက်ပြီ] ဒိုင်လှည့်ခွင့်မပေးခင် ၎င်း Session ထဲမှာ အယောက် ၂၀ တိတိ ပြည့်/မပြည့် အရင်စစ်ဆေးခြင်း
        /*
        const [countResult] = await db.promise().query('SELECT COUNT(*) AS total FROM ranktbl WHERE session_name = ?', [finalSessionStr]);
        if (countResult[0].total < 20) { 
            return res.json({ 
                status: 'error', 
                message: `⚠️ Lucky Spin လှည့်ရန် ကစားသမား ၂၀ ဦး မပြည့်သေးပါ! (လက်ရှိပေါက်ပြီးသူ: ${countResult[0].total} ဦး)` 
            });
        }*/

        // ၂။ ဆုမဲများ ကျန်သေးလား စစ်ဆေးခြင်း
        const [prizes] = await db.promise().query("SELECT * FROM prizetbl WHERE prizecount > 0");
        if (prizes.length === 0) return res.json({ status: 'empty', message: 'ဆုမဲများအားလုံး ကုန်သွားပါပြီ!' });

        // ၃။ ဆုမဲ ရွေးချယ်ခြင်း
        const randomIndex = Math.floor(Math.random() * prizes.length);
        const wonPrize = prizes[randomIndex];

        // ၄။ ဆုမဲအရေအတွက်ထဲမှ ၁ ခု နှုတ်ခြင်း
        await db.promise().query("UPDATE prizetbl SET prizecount = prizecount - 1 WHERE prizeid = ?", [wonPrize.prizeid]);

        // ၅။ [INSERT အစား UPDATE သို့ ပြောင်းလဲခြင်း] - save-winner ကဏ္ဍတွင် record ရှိပြီးသားဖြစ်၍ prizeid ကိုသာ မဲနှိုက်ပြီး အစားထိုးခြင်း
        await db.promise().query("UPDATE ranktbl SET prizeid = ? WHERE userid = ? AND session_name = ?", [wonPrize.prizeid, userid, finalSessionStr]);

        // ၆။ အောင်မြင်ရင် Frontend ဘက်ကို Clear လုပ်ခိုင်းဖို့ အချက်အလက်ပါ တွဲပို့ပေးလိုက်မယ်
        res.json({ 
            status: 'success', 
            prizeid: wonPrize.prizeid, 
            prizeName: wonPrize.prizename, 
            clearSession: true 
        });

    } catch (err) {
        console.error("Spin Error:", err);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
});

// 🛠️ SAVE WINNER ENDPOINT (ပထမဦးဆုံး လူ ၂၀ ဦး တိတိသာ လက်ခံမည့်အပိုင်း)
app.post('/api/save-winner', (req, res) => {
    const { userid, username, userph, session_name } = req.body;
    const finalSessionStr = String(session_name);

    // လက်ရှိ session မှာ ဘယ်နှယောက် နိုင်ပြီးပြီလဲ အရင်ဆုံး စစ်ဆေးခြင်း
    const countSql = "SELECT COUNT(*) AS total FROM ranktbl WHERE session_name = ?";
    db.query(countSql, [finalSessionStr], (err, countResult) => {
        if (err) return res.status(500).json({ success: false, error: err.message });

        if (countResult[0].total >= 20) {
            return res.json({ success: false, message: "🚨 စိတ်မကောင်းပါဘူးဗျာ... ဒီပွဲအတွက် ကံထူးရှင် ၂၀ ဦး ပြည့်သွားပါပြီ။" });
        }

        // မပြည့်သေးပါက ထည့်သွင်းမည် (မဲမလှည့်ရသေးမီ စောစီးစွာ ဝင်လာသူဖြစ်၍ prizeid ကို 0 ထားဦးမည်)
        const insertSql = "INSERT INTO ranktbl (userid, session_name, prizeid) VALUES (?, ?, 0)";
        db.query(insertSql, [userid, finalSessionStr], (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });

            const currentTotal = countResult[0].total + 1;
            
            // Socket ကနေ ကစားသမားအားလုံးဆီ လက်ရှိ နိုင်သူအရေအတွက် တိုက်ရိုက် လှမ်းအော်မည်
            io.emit('winnerCountUpdate', { count: currentTotal, latestWinner: username });

            // အကယ်၍ ၂၀ မြောက်လူလည်း ဖြစ်သွားရော ဒိုင်စကရင်မှာ Popup ထပြရန် Trigger ထုတ်ပေးခြင်း
            if (currentTotal === 20) {
                io.emit('twentyWinnersComplete', { session: finalSessionStr });
            }

            res.json({ success: true, winnerCount: currentTotal });
        });
    });
});

// 🛠️ PROFILE API
app.get('/api/profile/:id', (req, res) => {
    const userId = req.params.id;
    const query = 'SELECT userid, username, userph, useremail, userage, useroccup FROM usertbl WHERE userid = ?';
    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error("❌ Profile DB Query Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
        if (results.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const user = results[0];
        res.json({
            success: true,
            userid: user.userid,
            username: user.username,
            userph: user.userph,
            useremail: user.useremail,
            userage: user.userage,
            useroccup: user.useroccup
        });
    });
});

// ================= RANKING LIST API =================
app.get('/api/ranking', (req, res) => {
    const sqlQuery = `
        SELECT r.rankid, u.username, u.userph, p.prizename, r.session_name
        FROM \`ranktbl\` r
        INNER JOIN usertbl u ON r.userid = u.userid
        LEFT JOIN prizetbl p ON r.prizeid = p.prizeid
        ORDER BY r.rankid ASC
    `;
    db.query(sqlQuery, (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (results.length === 0) return res.status(200).json({ success: true, message: "No ranking data yet.", data: [] });
        res.status(200).json({ success: true, count: results.length, data: results });
    });
});

app.get('/api/winners/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const query = `
        SELECT u.username, u.userph, p.prizename, p.prizeid, r.session_name
        FROM ranktbl r
        INNER JOIN usertbl u ON r.userid = u.userid
        INNER JOIN prizetbl p ON r.prizeid = p.prizeid
        WHERE r.session_name = ?
        ORDER BY 
            CASE 
                WHEN p.prizename LIKE '%Diamond%' THEN 1
                WHEN p.prizename LIKE '%Gold%' THEN 2
                WHEN p.prizename LIKE '%Silver%' THEN 3
                WHEN p.prizename LIKE '%Bronze%' THEN 4
                ELSE 5
            END ASC;
    `;
    db.query(query, [sessionId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 🛠️ USER API
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    const sql = "SELECT userid, username, userph, useremail, userage, useroccup FROM usertbl WHERE userid = ?";
    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error("Database query error:", err);
            return res.status(500).json({ error: "Database query error" });
        }
        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.status(404).json({ error: "User not found" });
        }
    });
});

/* START SERVER */
/* START SERVER (Dynamic Port for Hosting) */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server Running On Port ${PORT} (Unified Bingo Core)`);
});
