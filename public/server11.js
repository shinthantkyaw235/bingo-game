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

/* DATABASE CONNECTION */
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "1322003S9102006K@",
    database: "bingo"
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
let bingoInterval = null;
let currentSessionId = "1"; // 🔴 လက်ရှိ Session ID ကို မှတ်ထားရန် ထည့်သွင်းချက် (Default: Session 1)
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
        currentNumber: randomNumber
    });
}

/* 🌐 REAL-TIME SOCKET.IO EVENT HANDLERS */
io.on("connection", (socket) => {
    
    // Admin ဆီက လာတဲ့ Session အသစ်စတင်ခြင်းကို စောင့်ဖမ်းမယ်
    socket.on("startNewSession", (data) => {
        console.log(`Admin started a new session: Session ${data.sessionId}`);
        
        // 🔴 ချိတ်ဆက်ထားသမျှ Player အားလုံးဆီကို Session ID လှမ်းပို့လိုက်မယ်
        io.emit("sessionChanged", { sessionId: data.sessionId });
    });

    // 🔴 [NEW] Admin က Session အသစ်ပြောင်းပြီး "SESSION စတင်မည်" ကို နှိပ်လိုက်တဲ့အခါ
    socket.on("startNewSession", (data) => {
        if (data && data.sessionId) {
            currentSessionId = data.sessionId; // Server Memory မှာ ID သိမ်းမယ်
            console.log(`📢 [SERVER SIDE] Admin triggered a new session: Session ${currentSessionId}`);
            
            // ချိတ်ဆက်ထားသမျှ Player အားလုံးဆီကို Session ID အသစ် ချက်ချင်း ဖြန့်ဝေပေးလိုက်မယ်
            io.emit("sessionChanged", { sessionId: currentSessionId });
        }
    });

    // Page Refresh ဖြစ်သွားရင် လက်ရှိ ဂိမ်းအခြေအနေကို ချက်ချင်း ပြန်ပို့ပေးခြင်း
    socket.emit("gameUpdate", {
        history: gameHistory,
        currentNumber: gameHistory[gameHistory.length - 1] || "--"
    });

    // Send the current baseline player count directly to the newly connected socket
    io.emit("updatePlayerCount", playerSockets.size);

    // 🚀 ဒိုင် (Host) က ဂိမ်းစတင်လိုက်တဲ့အခါ (၁၀ စက္ကန့် Loop မောင်းမည်)
    socket.on("startGameLoop", () => {
        if (bingoInterval) clearInterval(bingoInterval);

        console.log("🏁 [SERVER SIDE] Host activated 'Go!'. Starting 10-second automatic interval...");
        serverGenerateBingoNumber();

        bingoInterval = setInterval(() => {
            serverGenerateBingoNumber();
        }, 10000); 
    });

    // ကစားသမားတစ်ဦးက BINGO လို့ နှိပ်လိုက်တဲ့အခါ
    socket.on("playerBingo", (data) => {
        const { winnerName, userid } = data;

        // ၁။ နံပါတ်အလိုအလျောက် ထွက်နေတာကို ချက်ချင်း ခေတ္တရပ်ဆိုင်းလိုက်မည် (Pause)
        if (bingoInterval) {
            clearInterval(bingoInterval);
            bingoInterval = null;
            console.log("⏸️ [SERVER SIDE] Bingo claimed! Interval paused.");
        }
        
        console.log(`🏆 [SERVER SIDE] BINGO CLAIMS! Winner: ${winnerName} (ID: ${userid})`);

        // ၂။ ကျန်တဲ့ ကစားသမားအားလုံးဆီကို ဘယ်သူနိုင်သွားလဲဆိုတာ လှမ်းပြီး Alert ပြခိုင်းမည်
        io.emit("announceWinner", {
            winnerId: socket.id,
            winnerName: winnerName
        });

        // ၃။ နိုင်တဲ့သူရဲ့ User ID ကို Database ရဲ့ `ranktbl` ထဲသို့ ထည့်သွင်းမည်
        if (userid) {
            const checkDuplicateSql = "SELECT userid FROM `ranktbl` WHERE userid = ? LIMIT 1";
            
            db.query(checkDuplicateSql, [userid], (checkErr, checkResults) => {
                if (checkErr) {
                    return console.error("❌ Error checking ranking duplications:", checkErr);
                }

                if (checkResults.length === 0) {
                    const insertRankSql = "INSERT INTO `ranktbl` (userid, prizeid) VALUES (?, 0)";
                    
                    db.query(insertRankSql, [userid], (insertErr, insertResult) => {
                        if (insertErr) {
                            if (insertErr.code === 'ER_DUP_ENTRY') {
                                return console.log(`⚠️ User ID ${userid} already exists (Database Unique Guard).`);
                            }
                            return console.error("❌ SQL Error inserting winner to rank table:", insertErr);
                        }
                        console.log(`💾 Successfully inserted User ID ${userid} to 'ranktbl'.`);
                    });
                } else {
                    console.log(`⚠️ User ID ${userid} already exists in 'ranktbl'. Skipping write.`);
                }
            });
        } else {
            console.log("⚠️ Cannot insert into 'ranktbl' because User ID is missing or anonymous.");
        }
    });

    // ဒိုင် (Host) ဘက်က Alert Modal တွင် OK နှိပ်ပြီး ဂိမ်းပြန်ဆက်ခိုင်းသည့်အခါ
    socket.on("resumeGameFromHost", () => {
        if (bingoInterval) clearInterval(bingoInterval);

        console.log("▶️ [SERVER SIDE] Host clicked OK. Resuming 10-second automatic interval...");

        io.emit("gameResume"); 

        serverGenerateBingoNumber();
        bingoInterval = setInterval(() => {
            serverGenerateBingoNumber();
        }, 10000);
    });

    // ဒိုင်က ဂိမ်းအသစ်လုံးဝ ပြန်စချင်လို့ Reset နှိပ်လိုက်တဲ့အခါ
    socket.on("resetGame", () => {
        if (bingoInterval) clearInterval(bingoInterval);
        gameHistory = [];
        console.log("🔄 [SERVER SIDE] Game has been fully reset by Host.");
        io.emit("gameUpdate", { history: gameHistory, currentNumber: "--" });
        io.emit("gameResetByHost");
    });

    // ကစားသမား ထွက်သွားတဲ့အခါ စာရင်းလျှော့ခြင်း
    socket.on("disconnect", () => {
        if (playerSockets.has(socket.id)) {
            playerSockets.delete(socket.id);
        }
        console.log(`❌ [SERVER SIDE] A connection left. Active Tracking Count: ${playerSockets.size}`);
        io.emit("updatePlayerCount", playerSockets.size);
    });
});

/* --- DATABASE REST APIs --- */
app.post("/register", (req, res) => {
    const { username, userph, useremail, userage, useroccup } = req.body;
    const checkSql = "SELECT * FROM usertbl WHERE userph = ?";
    db.query(checkSql, [userph], (checkErr, checkResult) => {
        if (checkErr) return res.send({ success: false, message: "Database Error during validation" });
        if (checkResult.length > 0) return res.send({ success: false, message: "Phone number already exists" });

        const insertSql = `INSERT INTO usertbl (username, userph, useremail, userage, useroccup) VALUES (?, ?, ?, ?, ?)`;
        db.query(insertSql, [username, userph, useremail, userage, useroccup], (err, result) => {
            if (err) {
                res.send({ success: false, message: "Database Error during insertion" });
            } else {
                res.send({ success: true, message: "Registration Successful", redirect: "login.html" });
            }
        });
    });
});

app.post("/login", (req, res) => {
    const { userph } = req.body;
    const sql = `SELECT * FROM usertbl WHERE userph = ?`;
    db.query(sql, [userph], (err, result) => {
        if (err) res.send({ success: false });
        else res.send({ success: result.length > 0, user: result[0] || null });
    });
});

app.post("/api/verify-stampcode", (req, res) => {
    const { stampCode, userph } = req.body;
    if (!stampCode || !userph) return res.status(400).send({ success: false, message: "Missing required inputs" });

    const findStampSql = "SELECT * FROM stamptable WHERE stampcode = ? LIMIT 1";
    db.query(findStampSql, [stampCode], (stampErr, stampResult) => {
        if (stampErr || stampResult.length === 0) return res.status(404).send({ success: false, message: "Invalid or used Code." });

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

                const deleteStampSql = "DELETE FROM stamptable WHERE stampcode = ?";
                db.query(deleteStampSql, [stampCode], () => {
                    return res.status(200).send({ success: true, message: "Stamp verified and processed!" });
                });
            });
        });
    });
});

app.get('/api/profile/:id', (req, res) => {
    db.query('SELECT userid, username, userph, useremail, userage, useroccup FROM usertbl WHERE userid = ?', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(results[0]);
    });
});

app.get('/api/ranking', (req, res) => {
    const sqlQuery = `
        SELECT r.rankid, u.username, u.userph, p.prizename
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

// ================= ၁။ LUCKY SPIN LOGIC API =================
app.post('/api/spin', (req, res) => {
    const { userid, sessionid } = req.body; 

    if (!userid || !sessionid) {
        return res.status(400).json({ status: 'error', message: 'User ID နှင့် Session ID လိုအပ်ပါသည်!' });
    }

    const getAvailablePrizesQuery = "SELECT * FROM prizetbl WHERE prizecount > 0";
    
    db.query(getAvailablePrizesQuery, (err, prizes) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (prizes.length === 0) {
            return res.json({ status: 'empty', message: 'ဆုမဲများအားလုံး ကုန်သွားပါပြီ!' });
        }

        const randomIndex = Math.floor(Math.random() * prizes.length);
        const wonPrize = prizes[randomIndex]; 

        const updateCountQuery = "UPDATE prizetbl SET prizecount = prizecount - 1 WHERE prizeid = ?";
        
        db.query(updateCountQuery, [wonPrize.prizeid], (updateErr) => {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            
            const insertRankingQuery = "INSERT INTO rankingtbl (userid, prizeid, sessionid) VALUES (?, ?, ?)";
            
            db.query(insertRankingQuery, [userid, wonPrize.prizeid, sessionid], (insertErr) => {
                if (insertErr) return res.status(500).json({ error: insertErr.message });

                res.json({
                    status: 'success',
                    prizeid: wonPrize.prizeid,      
                    prizename: wonPrize.prizename 
                });
            });
        });
    });
});

// ================= ၂။ ADMIN DASHBOARD WINNERS LIST API =================
app.get('/api/winners/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;

    const query = `
        SELECT 
            u.username, 
            u.userph, 
            p.prizename,
            p.prizeid,
            r.sessionid
        FROM rankingtbl r
        INNER JOIN usertbl u ON r.userid = u.userid
        INNER JOIN prizetbl p ON r.prizeid = p.prizeid
        WHERE r.sessionid = ?
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
        if (err) {
            console.error("❌ SQL Query Error:", err.message);
            return res.status(500).json({ error: err.message, details: "SQL Query အလုပ်မလုပ်ပါ။ Table Column နာမည်များကို ပြန်စစ်ပါ။" });
        }
        res.json(results);
    });
});

/* START SERVER */
server.listen(3000, () => {
    console.log("🚀 Server Running On Port 3000 (Unified Bingo Core)");
});