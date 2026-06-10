const canvas = document.querySelector("#game");
const context = canvas.getContext("2d");
const status = document.querySelector("#status");

const player = {
  x: canvas.width / 2 - 22,
  y: canvas.height - 48,
  width: 44,
  height: 18,
  speed: 7,
};

let score = 0;
let running = true;
let keys = new Set();
let stars = [];
let asteroids = [];
let frame = 0;

function resetGame() {
  score = 0;
  running = true;
  stars = [];
  asteroids = [];
  frame = 0;
  player.x = canvas.width / 2 - player.width / 2;
  status.textContent = "Score: 0";
}

function spawnFallingItem(collection, radius, color) {
  collection.push({
    x: Math.random() * (canvas.width - radius * 2) + radius,
    y: -radius,
    radius,
    color,
    speed: Math.random() * 2 + 2,
  });
}

function drawPlayer() {
  context.fillStyle = "#8ef0c3";
  context.fillRect(player.x, player.y, player.width, player.height);
  context.fillRect(player.x + 14, player.y - 10, 16, 10);
}

function drawItem(item) {
  context.beginPath();
  context.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
  context.fillStyle = item.color;
  context.fill();
}

function collidesWithPlayer(item) {
  const closestX = Math.max(player.x, Math.min(item.x, player.x + player.width));
  const closestY = Math.max(player.y, Math.min(item.y, player.y + player.height));
  const distanceX = item.x - closestX;
  const distanceY = item.y - closestY;

  return distanceX * distanceX + distanceY * distanceY < item.radius * item.radius;
}

function updateItems(collection, onCollision) {
  for (const item of collection) {
    item.y += item.speed;
  }

  for (const item of collection.filter(collidesWithPlayer)) {
    onCollision(item);
  }

  return collection.filter((item) => item.y < canvas.height + item.radius);
}

function update() {
  if (keys.has("ArrowLeft") || keys.has("a")) {
    player.x -= player.speed;
  }

  if (keys.has("ArrowRight") || keys.has("d")) {
    player.x += player.speed;
  }

  player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));

  if (frame % 55 === 0) {
    spawnFallingItem(stars, 9, "#ffd166");
  }

  if (frame % 90 === 0) {
    spawnFallingItem(asteroids, 14, "#ef476f");
  }

  stars = updateItems(stars, (star) => {
    score += 1;
    star.y = canvas.height + star.radius;
  });

  asteroids = updateItems(asteroids, () => {
    running = false;
    status.textContent = `Final score: ${score}. Press space to restart.`;
  });

  if (running) {
    status.textContent = `Score: ${score}`;
  }
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const star of stars) {
    drawItem(star);
  }

  for (const asteroid of asteroids) {
    drawItem(asteroid);
  }

  drawPlayer();
}

function loop() {
  if (running) {
    update();
    frame += 1;
  }

  draw();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  keys.add(event.key);

  if (event.code === "Space" && !running) {
    resetGame();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key);
});

loop();
