const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./game.db', (err) => {
  if (err) console.error(err.message);
  console.log('Connected to the SQLite database.');
});


// Dinagdag natin ang 'wins' column
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  wins INTEGER DEFAULT 0 
)`);

// Function para kunin ang Top 5 players sa database
function broadcastLeaderboard() {
  db.all(`SELECT username, wins FROM users ORDER BY wins DESC LIMIT 5`, [], (err, rows) => {
    if (!err) {
      io.emit('updateLeaderboard', rows);
    }
  });
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Load natin yung public static files
app.use(express.static(__dirname + '/public_static'));

const players = {};
const playerSize = 25;
const canvasSize = 500;

function randomFoodPosition() {
  return {
    x: Math.floor(Math.random() * (canvasSize - playerSize)),
    y: Math.floor(Math.random() * (canvasSize - playerSize))
  };
}

let food = randomFoodPosition();

io.on('connection', (socket) => {
  console.log('May nag-connect sa server, ID:', socket.id);

  // Ipadala agad ang leaderboard kahit hindi pa naka-login
  broadcastLeaderboard();

  // --- SIGN UP LOGIC ---
  socket.on('register', async (data) => {
    const { username, password } = data;
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const sql = `INSERT INTO users (username, password) VALUES (?, ?)`;
    db.run(sql, [username, hashedPassword], function(err) {
      if (err) socket.emit('register_error', 'Username already taken!');
      else socket.emit('register_success', 'Account created! Pwede ka na mag-login.');
    });
  });

  // --- LOGIN LOGIC ---
  socket.on('login', (data) => {
    const { username, password } = data;
    const sql = `SELECT * FROM users WHERE username = ?`;
    
    db.get(sql, [username], async (err, row) => {
      if (err || !row) {
        socket.emit('login_error', 'Mali ang username o password.');
        return;
      }

      const match = await bcrypt.compare(password, row.password);
      if (match) {
        players[socket.id] = {
          x: Math.floor(Math.random() * 400) + 50,
          y: Math.floor(Math.random() * 400) + 50,
          score: 0,
          username: username
        };

        // INUPDATE: Ipapasa na natin ang username pabalik para mai-save ng browser sa LocalStorage
        socket.emit('login_success', username); 
        io.emit('updatePlayers', players);
        socket.emit('updateFood', food);
        broadcastLeaderboard(); 
      } else {
        socket.emit('login_error', 'Mali ang username o password.');
      }
    });
  });

  // --- BAGONG AUTO-LOGIN LOGIC (Para sa LocalStorage Refresh) ---
  socket.on('autoLogin', (username) => {
    const sql = `SELECT * FROM users WHERE username = ?`;
    
    db.get(sql, [username], (err, row) => {
      // Kung may nahanap na user sa database
      if (!err && row) {
        players[socket.id] = {
          x: Math.floor(Math.random() * 400) + 50,
          y: Math.floor(Math.random() * 400) + 50,
          score: 0,
          username: username
        };

        socket.emit('login_success', username);
        io.emit('updatePlayers', players);
        socket.emit('updateFood', food);
        broadcastLeaderboard();
      } else {
        socket.emit('force_logout');
      }
    });
  });

  // --- MOVEMENT LOGIC ---
  socket.on('move', (direction) => {
    if (!players[socket.id]) return; 

    const speed = 10; // 10 
    const maxPos = canvasSize - playerSize;
    let player = players[socket.id];

    if (direction === 'up' && player.y - speed >= 0) player.y -= speed;
    if (direction === 'down' && player.y + speed <= maxPos) player.y += speed;
    if (direction === 'left' && player.x - speed >= 0) player.x -= speed;
    if (direction === 'right' && player.x + speed <= maxPos) player.x += speed;

    // Food Collision Logic
    if (
      player.x < food.x + playerSize && player.x + playerSize > food.x &&
      player.y < food.y + playerSize && player.y + playerSize > food.y
    ) {
      player.score++;
      food = randomFoodPosition();
      io.emit('updateFood', food);

      // WIN CONDITION: Kapag naka-5 points na ang player
      if (player.score >= 5) {
        // I-update ang wins ng nanalo sa Database
        db.run(`UPDATE users SET wins = wins + 1 WHERE username = ?`, [player.username], (err) => {
          if (!err) broadcastLeaderboard(); // I-refresh ang leaderboard sa lahat
        });

        // I-announce na may nanalo!
        io.emit('gameAnnouncement', `🏆 Nanalo si ${player.username}! Resetting scores...`);

        // I-reset ang scores ng lahat ng nandun pabalik sa 0 para sa next round
        for (let id in players) {
          players[id].score = 0;
        }
      }
    }

    io.emit('updatePlayers', players);
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      delete players[socket.id];
      io.emit('updatePlayers', players);
    }
  });
});

// Pinanatili ko ang Port 5000 mo
http.listen(5000, () => {
  console.log('Game Server is running on http://localhost:5000');
});
