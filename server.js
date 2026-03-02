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


// classes
class player {
    velocity_x = 0;
    velocity_y = 0;

    constructor (x, y, score, name) {
        this.x = x;
        this.y = y;
        this.score = score;
        this.username = name;
    }
}


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
        players[socket.id] = new player((Math.floor(Math.random() * 400) + 50), (Math.floor(Math.random() * 400) + 50), 0, username);
        /*
        players[socket.id] = {
          x: Math.floor(Math.random() * 400) + 50,
          y: Math.floor(Math.random() * 400) + 50,
          score: 0,
          username: username
        };*/

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
        players[socket.id] = new player((Math.floor(Math.random() * 400) + 50), (Math.floor(Math.random() * 400) + 50), 0, username);
        /*players[socket.id] = {
          x: Math.floor(Math.random() * 400) + 50,
          y: Math.floor(Math.random() * 400) + 50,
          score: 0,
          username: username
        };*/

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

    const speed = 4; // 10 
    const jump = 4;
    const maxPos = canvasSize - playerSize;
    let player = players[socket.id];

    if (direction === 'up' && player.y - speed >= 0){ player.y -= 2; player.velocity_y = -jump; }
    if (direction === 'down') player.velocity_y = 1;
    if (direction === 'left') player.velocity_x = -speed;
    if (direction === 'right') player.velocity_x = speed;

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

let gravity = 1;
let friction = 0.1;
const updatePhysics = () => {
    //Gravity and friction
    for (let id in players) {
        // Y out of bounds
        if (players[id].y < canvasSize-25) players[id].velocity_y += gravity;
        else { players[id].velocity_y = 0; players[id].y = canvasSize - 25; }

        if (players[id].y < 0) players[id].y = 1;

        // X out of bounds
        if (players[id].x > canvasSize-25) players[id].x = canvasSize-28;
        if (players[id].x < 0) players[id].x = 1;

        players[id].y += players[id].velocity_y;
        players[id].x += players[id].velocity_x;
        players[id].velocity_x *= friction;
        io.emit('updatePlayers', players);
    }
};

const updateCollisionStuff = () => {
    for (let id in players) {
        for (let id2 in players) {
            if (id == id2) continue;
            let player1 = players[id];
            let player2 = players[id2];
            let colX = player1.x < (player2.x + playerSize) && (player1.x + playerSize) > player2.x;
            let colY = player1.y < (player2.y + playerSize) && (player1.y + playerSize) > player2.y;

            if (colX && colY) {
                //console.log(`${player1.username} and ${player2.username} are colliding.`);

                let res_intensity = 1.6;
                player2.velocity_x = ((player2.x + (playerSize / 2)) - (player1.x + (playerSize / 2))) * res_intensity;
                player2.velocity_y = ((player2.y + (playerSize / 2)) - (player1.y + (playerSize / 2))) * res_intensity;
                io.emit('updatePlayers', players);
                /*
                player2.velocity_x = player1.velocity_x;
                player2.velocity_y = player1.velocity_y;
                player1.velocity_x = 0;
                player1.velocity_y = 0;
                */
            }
        }
    }
};

setInterval(() => {
    updatePhysics();
}, 20);
setInterval(() => {
    updateCollisionStuff();
}, 30);

// Pinanatili ko ang Port 5000 mo
http.listen(5000, () => {
  console.log('Game Server is running on http://localhost:5000');
});
