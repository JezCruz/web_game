const socket = io();

const authContainer = document.getElementById('auth-container');
const gameContainer = document.getElementById('game-container');
const authForm = document.getElementById('auth-form');
const toggleAuth = document.getElementById('toggle-auth');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const leaderboardList = document.getElementById('leaderboard-list');
const logoutBtn = document.getElementById('logout-btn');
const canvas = document.getElementById('gameCanvas');

let isLoginMode = true; 
let players;
let currentFood = {};

// --- CHECK LOCAL STORAGE ON PAGE LOAD ---
const savedUser = localStorage.getItem('game_session');
if (savedUser) {
  // Kung may naka-save sa storage, i-bypass ang login screen at padalhan ang server ng signal
  socket.emit('autoLogin', savedUser);
}

// --- LOGOUT FUNCTION ---
logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('game_session'); // Burahin ang session
  location.reload(); // I-refresh ang page para bumalik sa Login screen
});

socket.on('force_logout', () => {
  localStorage.removeItem('game_session');
  location.reload();
});

// --- REGULAR UI TOGGLES ---
toggleAuth.addEventListener('click', () => {
  isLoginMode = !isLoginMode;
  document.getElementById('auth-title').innerText = isLoginMode ? "Login to Play" : "Create an Account";
  document.getElementById('auth-btn').innerText = isLoginMode ? "Login" : "Register";
  toggleAuth.innerText = isLoginMode ? "Wala pang account? Mag-Register dito." : "May account na? Mag-Login dito.";
});

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (isLoginMode) socket.emit('login', { username: usernameInput.value, password: passwordInput.value });
  else socket.emit('register', { username: usernameInput.value, password: passwordInput.value });
});

socket.on('register_success', (msg) => { alert(msg); toggleAuth.click(); passwordInput.value = ''; });
socket.on('register_error', (msg) => alert('Error: ' + msg));
socket.on('login_error', (msg) => alert('Error: ' + msg));

socket.on('updateLeaderboard', (topPlayers) => {
  leaderboardList.innerHTML = ''; 
  topPlayers.forEach((player, index) => {
    const li = document.createElement('li');
    li.innerText = `${index + 1}. ${player.username} - ${player.wins} Wins`;
    leaderboardList.appendChild(li);
  });
});

socket.on('gameAnnouncement', (msg) => { setTimeout(() => alert(msg), 100); });

// --- SUCCESSFUL LOGIN (Mula man sa Form o AutoLogin) ---
socket.on('login_success', (username) => {
  // I-SAVE SA LOCAL STORAGE ANG USERNAME
  localStorage.setItem('game_session', username);

  authContainer.style.display = 'none';
  gameContainer.style.display = 'inline-block'; 

  socket.on('updateFood', (newFood) => { currentFood = newFood; });

  socket.on('updatePlayers', (all_players) => {
		players = all_players
  });

  // Keyboard movement logic
  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'w') socket.emit('move', 'up');
    if (event.key === 'ArrowDown' || event.key === 's') socket.emit('move', 'down');
    if (event.key === 'ArrowLeft' || event.key === 'a') socket.emit('move', 'left');
    if (event.key === 'ArrowRight' || event.key === 'd') socket.emit('move', 'right');
  });
});

let lerpPositions = {}; //Lerping the movements of the players 
// --- MAIN GAME LOOP ---
let updateGame = () => {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	if (currentFood.x !== undefined) {
		ctx.fillStyle = '#f1c40f';
		ctx.fillRect(currentFood.x, currentFood.y, 25, 25);
	}

	for (let id in players) {
		let player = players[id];
		ctx.fillStyle = (id === socket.id) ? '#3498db' : '#e74c3c';

		if (!lerpPositions[id]) {
			lerpPositions[id] = {x: player.x, y: player.y};
		}

		let lerpValue = 0.15;
		lerpPositions[id].x += (player.x - lerpPositions[id].x) * lerpValue;
		lerpPositions[id].y += (player.y - lerpPositions[id].y) * lerpValue;
		let finPos = {x: lerpPositions[id].x, y: lerpPositions[id].y} // Final position

		// Past: player.x, player.y
		ctx.fillRect(finPos.x, finPos.y, 25, 25);
		ctx.fillStyle = 'black';
		ctx.font = 'bold 12px Arial';
		ctx.fillText(`${player.username} (${player.score})`, finPos.x - 10, finPos.y - 8);
	}

	requestAnimationFrame(updateGame);
};

requestAnimationFrame(updateGame);
