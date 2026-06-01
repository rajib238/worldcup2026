const express = require('express');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');

const app = express();

// Use /data/game.db on Render, fallback to local file
const DB_PATH = process.env.RENDER ? '/data/game.db' : 'game.db';
const db = new Database(DB_PATH);

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
  secret: 'worldcup2026-secret',
  resave: false,
  saveUninitialized: false
}));

// Mobile-friendly base styles
const baseStyles = `
  <style>
    body { font-family: system-ui, sans-serif; margin: 10px; max-width: 900px; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; display: block; overflow-x: auto; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: center; white-space: nowrap; }
    input[type="number"], input[type="email"], input[type="password"] {
      padding: 6px; font-size: 1rem; width: 80px;
    }
    input[type="submit"], button {
      padding: 8px 14px; border-radius: 6px;
      border: 1px solid #2563eb; background: #2563eb;
      color: white; cursor: pointer; font-size: 1rem;
    }
    .nav a { margin-right: 10px; }
  </style>
`;

// ----------------------
// DATABASE SETUP
// ----------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  kickoff_time TEXT NOT NULL,
  stage TEXT NOT NULL,
  group_name TEXT,
  final_home_score INTEGER,
  final_away_score INTEGER
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  predicted_home INTEGER NOT NULL,
  predicted_away INTEGER NOT NULL,
  points INTEGER DEFAULT 0,
  UNIQUE(user_id, match_id)
);
`);

// Seed 6 players with passwords
const players = [
  { name: 'Prabesh', email: 'prabeshsingh@gmail.com', password: 'pass123' },
  { name: 'Gaurave', email: 'gaurav18np@gmail.com', password: 'pass123' },
  { name: 'Rajib',   email: 'rajib238@gmail.com',   password: 'pass123' },
  { name: 'Sandeep', email: 'shree1sandeep@gmail.com', password: 'pass123' },
  { name: 'Shaymji', email: 'shyamjikc@gmail.com', password: 'pass123' },
  { name: 'Subash',  email: 'srijal146@gmail.com',  password: 'pass123' }
];

const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
if (userCount === 0) {
  const insert = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)");
  players.forEach(p => {
    const hash = bcrypt.hashSync(p.password, 10);
    insert.run(p.name, p.email, hash);
  });
}

// Load group matches from SQL file
const matchCount = db.prepare("SELECT COUNT(*) AS c FROM matches").get().c;
if (matchCount === 0) {
  const sql = fs.readFileSync('group_matches.sql', 'utf8');
  db.exec(sql);
}

// ----------------------
// HELPERS
// ----------------------
function resultType(h, a) {
  if (h > a) return "H";
  if (h < a) return "A";
  return "D";
}

function scorePrediction(pred, match) {
  if (match.final_home_score == null) return 0;

  const ph = pred.predicted_home;
  const pa = pred.predicted_away;
  const rh = match.final_home_score;
  const ra = match.final_away_score;

  if (ph === rh && pa === ra) return 5;
  if (resultType(ph, pa) === resultType(rh, ra)) return 3;
  if ((ph - pa) === (rh - ra)) return 1;

  return 0;
}

function recalcPoints(matchId) {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match || match.final_home_score == null) return;

  const preds = db.prepare("SELECT * FROM predictions WHERE match_id = ?").all(matchId);
  const update = db.prepare("UPDATE predictions SET points = ? WHERE id = ?");

  preds.forEach(p => update.run(scorePrediction(p, match), p.id));
}

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// ----------------------
// ROUTES
// ----------------------

// Login page
app.get('/login', (req, res) => {
  res.send(`
    <html><head>${baseStyles}<meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body>
      <h1>Login</h1>
      <form method="POST" action="/login">
        <div><input name="email" type="email" placeholder="Email" required /></div>
        <div><input name="password" type="password" placeholder="Password" required /></div>
        <div><input type="submit" value="Login" /></div>
      </form>
    </body></html>
  `);
});

// Login handler
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.send("Invalid email or password");
  }

  req.session.userId = user.id;
  res.redirect('/me/matches');
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Home
app.get("/", (req, res) => {
  res.redirect("/login");
});

// User match list
app.get("/me/matches", requireLogin, (req, res) => {
  const uid = req.session.userId;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(uid);

  const matches = db.prepare(`
    SELECT m.*, p.predicted_home, p.predicted_away, p.points
    FROM matches m
    LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?
    ORDER BY m.kickoff_time
  `).all(uid);

  res.send(`
    <html><head>${baseStyles}<meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body>
      <h1>${user.name} – Predictions</h1>
      <div class="nav">
        <a href="/leaderboard">Leaderboard</a>
        <a href="/logout">Logout</a>
      </div>
      <table>
        <tr><th>Match</th><th>Kickoff</th><th>Predict</th><th>Points</th></tr>
        ${matches.map(m => `
          <tr>
            <td>${m.home_team} vs ${m.away_team} (${m.group_name || m.stage})</td>
            <td>${m.kickoff_time}</td>
            <td>
              <form method="POST" action="/me/match/${m.id}">
                <input type="number" name="ph" min="0" value="${m.predicted_home ?? ""}" /> :
                <input type="number" name="pa" min="0" value="${m.predicted_away ?? ""}" />
                <input type="submit" value="Save" />
              </form>
            </td>
            <td>${m.points ?? 0}</td>
          </tr>
        `).join("")}
      </table>
    </body></html>
  `);
});

// Save prediction
app.post("/me/match/:mid", requireLogin, (req, res) => {
  const uid = req.session.userId;
  const { mid } = req.params;
  const ph = Number(req.body.ph);
  const pa = Number(req.body.pa);

  const existing = db.prepare("SELECT * FROM predictions WHERE user_id = ? AND match_id = ?").get(uid, mid);

  if (existing) {
    db.prepare("UPDATE predictions SET predicted_home = ?, predicted_away = ? WHERE id = ?")
      .run(ph, pa, existing.id);
  } else {
    db.prepare("INSERT INTO predictions (user_id, match_id, predicted_home, predicted_away) VALUES (?, ?, ?, ?)")
      .run(uid, mid, ph, pa);
  }

  recalcPoints(mid);
  res.redirect("/me/matches");
});

// Admin match list
app.get("/admin/matches", (req, res) => {
  const matches = db.prepare("SELECT * FROM matches ORDER BY kickoff_time").all();

  res.send(`
    <html><head>${baseStyles}<meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body>
      <h1>Admin – Enter Results</h1>
      <a href="/me/matches">Back</a>
      <table>
        <tr><th>Match</th><th>Kickoff</th><th>Final Score</th></tr>
        ${matches.map(m => `
          <tr>
            <td>${m.home_team} vs ${m.away_team}</td>
            <td>${m.kickoff_time}</td>
            <td>
              <form method="POST" action="/admin/match/${m.id}">
                <input type="number" name="fh" min="0" value="${m.final_home_score ?? ""}" /> :
                <input type="number" name="fa" min="0" value="${m.final_away_score ?? ""}" />
                <input type="submit" value="Save" />
              </form>
            </td>
          </tr>
        `).join("")}
      </table>
    </body></html>
  `);
});

// Save final score
app.post("/admin/match/:mid", (req, res) => {
  const { mid } = req.params;
  const fh = Number(req.body.fh);
  const fa = Number(req.body.fa);

  db.prepare("UPDATE matches SET final_home_score = ?, final_away_score = ? WHERE id = ?")
    .run(fh, fa, mid);

  recalcPoints(mid);
  res.redirect("/admin/matches");
});

// Leaderboard
app.get("/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.name, COALESCE(SUM(p.points), 0) AS total
    FROM users u
    LEFT JOIN predictions p ON p.user_id = u.id
    GROUP BY u.id
    ORDER BY total DESC
  `).all();

  res.send(`
    <html><head>${baseStyles}<meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body>
      <h1>Leaderboard</h1>
      <a href="/me/matches">Back</a>
      <table>
        <tr><th>Rank</th><th>Player</th><th>Points</th></tr>
        ${rows.map((r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${r.name}</td>
            <td>${r.total}</td>
          </tr>
        `).join("")}
      </table>
    </body></html>
  `);
});

// Start server
app.listen(3000, () => console.log("Running at http://localhost:3000"));
