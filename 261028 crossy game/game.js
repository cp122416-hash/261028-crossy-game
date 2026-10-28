const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Canvas roundRect 폴리필
if (!ctx.roundRect) {
  ctx.roundRect = function (x, y, w, h, r = 0) {
    const radius = typeof r === 'number' ? r : (r[0] || 0);
    this.beginPath();
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
    return this;
  };
}

// DOM 요소 참조
const currentScoreEl = document.getElementById('current-score');
const bestScoreEl = document.getElementById('best-score');
const screenReadyEl = document.getElementById('screen-ready');
const screenGameOverEl = document.getElementById('screen-gameover');
const btnStartEl = document.getElementById('btn-start');
const btnRestartEl = document.getElementById('btn-restart');
const finalScoreEl = document.getElementById('final-score');
const finalBestScoreEl = document.getElementById('final-best-score');
const gameOverReasonEl = document.getElementById('game-over-reason');

const btnUp = document.getElementById('btn-up');
const btnDown = document.getElementById('btn-down');
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');

// 게임 상수
const TILE_SIZE = 48;
const COLS = 10;
const CANVAS_WIDTH = canvas.width;   // 480
const CANVAS_HEIGHT = canvas.height; // 720
const CAMERA_THRESHOLD = CANVAS_HEIGHT * 0.6; // 화면 상단 60% 지점 (432px)
const STORAGE_KEY = 'crossy_best_score';

// 최고 점수 불러오기 (접근 실패 시에도 게임 정상 진행)
let bestScore = 0;
function loadBestScore() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) || 0 : 0;
  } catch (err) {
    console.warn('localStorage 읽기 불가:', err);
    return 0;
  }
}

function saveBestScore(val) {
  try {
    localStorage.setItem(STORAGE_KEY, val.toString());
  } catch (err) {
    console.warn('localStorage 저장 불가:', err);
  }
}

bestScore = loadBestScore();

// 게임 상태: 'READY' | 'PLAYING' | 'GAME_OVER'
let gameState = 'READY';
let gameOverReason = '';
let score = 0;
let maxRowReached = 0;

// 카메라 (월드 좌표계: 위쪽이 -Y, 아래쪽이 +Y)
const camera = {
  y: 0,
  targetY: 0,
};

// 플레이어 캐릭터
const player = {
  col: 4,
  row: 0,
  targetCol: 4,
  targetRow: 0,
  x: 0,
  y: 0,
  size: 34,
  hopProgress: 1, // 0~1 점프 애니메이션 진행도
  prevX: 0,
  prevY: 0,
};

// 행(Row) 관리
const rows = new Map();
let highestGeneratedRow = -4;
let consecutiveRoads = 0;
let consecutiveGrass = 0;

// 차량 색상 팔레트
const CAR_COLORS = [
  '#e74c3c', // 빨강
  '#3498db', // 파랑
  '#f39c12', // 주황
  '#9b59b6', // 보라
  '#1abc9c', // 청록
  '#e67e22', // 짙은 주황
];

// 월드 Y 좌표 계산
function getRowWorldY(row) {
  return -row * TILE_SIZE;
}

// 행 생성 함수
function createRow(rowIndex) {
  const worldY = getRowWorldY(rowIndex);
  let type = 'grass';

  // 시작 지점(행 0, 1, 2) 및 하단 행은 안전한 잔디 유지
  if (rowIndex <= 2) {
    type = 'grass';
    consecutiveGrass++;
    consecutiveRoads = 0;
  } else {
    // 도로는 최대 3개 행까지만 연속 생성
    if (consecutiveRoads >= 3) {
      type = 'grass';
    } else if (consecutiveGrass >= 2) {
      type = 'road';
    } else {
      type = Math.random() < 0.65 ? 'road' : 'grass';
    }

    if (type === 'road') {
      consecutiveRoads++;
      consecutiveGrass = 0;
    } else {
      consecutiveGrass++;
      consecutiveRoads = 0;
    }
  }

  const rowData = {
    row: rowIndex,
    worldY,
    type,
    vehicles: [],
  };

  // 도로일 경우 차량 설정 (최초 생성 시 확정, 프레임마다 재추첨 금지)
  if (type === 'road') {
    const direction = Math.random() < 0.5 ? 1 : -1;
    // 일정한 난이도를 위한 속도 (120 ~ 170 px/s)
    const speed = 120 + Math.random() * 50;
    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const carWidth = 62 + Math.floor(Math.random() * 12);
    const carHeight = 30;

    // 차량 2대를 고정된 간격으로 순환 배치
    const loopSpan = 560;
    const spacing = 280;
    const startOffset = Math.random() * loopSpan;

    for (let i = 0; i < 2; i++) {
      let x = (startOffset + i * spacing) % loopSpan - 80;
      rowData.vehicles.push({
        x,
        y: worldY + (TILE_SIZE - carHeight) / 2,
        width: carWidth,
        height: carHeight,
        speed,
        direction,
        color,
        loopSpan,
      });
    }
  }

  rows.set(rowIndex, rowData);
  return rowData;
}

// 화면 위쪽 행 미리 생성 & 카메라 아래로 벗어난 행 삭제
function updateRows() {
  const visibleTopRow = Math.ceil(-camera.y / TILE_SIZE);
  const targetTopRow = visibleTopRow + 10; // 10행 미리 생성

  while (highestGeneratedRow < targetTopRow) {
    highestGeneratedRow++;
    createRow(highestGeneratedRow);
  }

  // 카메라 아래로 충분히 벗어난 행 및 차량 삭제
  for (const [r, rowData] of rows) {
    const screenY = rowData.worldY - camera.y;
    if (screenY > CANVAS_HEIGHT + TILE_SIZE * 3) {
      rows.delete(r);
    }
  }
}

// HUD 점수 표시 갱신
function updateHUD() {
  if (currentScoreEl) currentScoreEl.textContent = score.toString();
  if (bestScoreEl) bestScoreEl.textContent = bestScore.toString();
}

// 게임 상태 변경 함수
function setGameState(newState, reason = '') {
  gameState = newState;
  gameOverReason = reason;

  if (newState === 'READY') {
    screenReadyEl.style.display = 'flex';
    screenGameOverEl.style.display = 'none';
    initWorld();
  } else if (newState === 'PLAYING') {
    screenReadyEl.style.display = 'none';
    screenGameOverEl.style.display = 'none';
    initWorld();
  } else if (newState === 'GAME_OVER') {
    screenReadyEl.style.display = 'none';
    screenGameOverEl.style.display = 'flex';

    if (finalScoreEl) finalScoreEl.textContent = score.toString();
    if (finalBestScoreEl) finalBestScoreEl.textContent = bestScore.toString();
    if (gameOverReasonEl) {
      gameOverReasonEl.textContent = (reason === 'FALL') ? '화면 밖으로 밀려났습니다!' : '차량과 충돌했습니다!';
    }
  }
}

// 월드 및 플레이어 초기화
function initWorld() {
  pressedKeys.clear();
  rows.clear();
  consecutiveRoads = 0;
  consecutiveGrass = 0;
  highestGeneratedRow = -4;

  // 플레이어 시작 위치: col 4, row 0
  player.col = 4;
  player.row = 0;
  player.targetCol = 4;
  player.targetRow = 0;
  player.x = player.col * TILE_SIZE + (TILE_SIZE - player.size) / 2;
  player.y = getRowWorldY(player.row) + (TILE_SIZE - player.size) / 2;
  player.prevX = player.x;
  player.prevY = player.y;
  player.hopProgress = 1;

  score = 0;
  maxRowReached = 0;
  updateHUD();

  // 시작 시 캐릭터가 화면 하단(약 12행 위치)에 위치하도록 카메라 설정
  const initialCameraY = -(CANVAS_HEIGHT - 3 * TILE_SIZE);
  camera.y = initialCameraY;
  camera.targetY = initialCameraY;

  // 초기 행 생성 (-3행부터 16행까지)
  for (let r = -3; r <= 16; r++) {
    createRow(r);
    highestGeneratedRow = r;
  }
}

// 공통 이동 함수 (키보드와 모바일 조작 버튼이 동일하게 사용)
function movePlayer(direction) {
  if (gameState !== 'PLAYING') return;

  let nextCol = player.targetCol;
  let nextRow = player.targetRow;

  if (direction === 'up') {
    nextRow += 1; // 위쪽으로 전진
  } else if (direction === 'down') {
    nextRow -= 1; // 뒤로 이동
  } else if (direction === 'left') {
    nextCol -= 1;
  } else if (direction === 'right') {
    nextCol += 1;
  }

  // 좌우 경계 검사
  if (nextCol < 0 || nextCol >= COLS) return;

  // 이동 확정
  player.prevX = player.x;
  player.prevY = player.y;
  player.targetCol = nextCol;
  player.targetRow = nextRow;
  player.col = nextCol;
  player.row = nextRow;
  player.hopProgress = 0; // 점프 애니메이션 시작

  // 점수 계산: 시작 위치에서 도달한 최고 전진 행 수 (좌우/재방문으로 미증가)
  if (player.row > maxRowReached) {
    maxRowReached = player.row;
    score = maxRowReached;
    if (score > bestScore) {
      bestScore = score;
      saveBestScore(bestScore);
    }
    updateHUD();
  }

  // 카메라 전진 처리: 캐릭터가 화면 높이의 60% 지점(432px)보다 위로 올라가려 하면 카메라가 따라감
  const playerWorldY = getRowWorldY(player.targetRow) + (TILE_SIZE - player.size) / 2;
  const desiredCameraY = playerWorldY - CAMERA_THRESHOLD;

  // 카메라는 앞으로만 진행하며, 뒤로 이동할 때 되돌아가지 않음
  if (desiredCameraY < camera.targetY) {
    camera.targetY = desiredCameraY;
  }
}

// 키보드 입력 처리
const pressedKeys = new Set();

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const preventKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd', 'r', 'enter'];
  if (preventKeys.includes(key)) {
    e.preventDefault();
  }

  if (gameState === 'READY') {
    if ([' ', 'enter', 'arrowup', 'w'].includes(key)) {
      setGameState('PLAYING');
    }
    return;
  }

  if (gameState === 'GAME_OVER') {
    if ([' ', 'enter', 'r', 'arrowup', 'w'].includes(key)) {
      setGameState('PLAYING');
    }
    return;
  }

  if (gameState === 'PLAYING') {
    if (e.repeat || pressedKeys.has(key)) return;
    pressedKeys.add(key);

    if (key === 'arrowup' || key === 'w') {
      movePlayer('up');
    } else if (key === 'arrowdown' || key === 's') {
      movePlayer('down');
    } else if (key === 'arrowleft' || key === 'a') {
      movePlayer('left');
    } else if (key === 'arrowright' || key === 'd') {
      movePlayer('right');
    }
  }
});

window.addEventListener('keyup', (e) => {
  pressedKeys.delete(e.key.toLowerCase());
});

// 모바일 버튼 바인딩 (터치 1회당 정확히 1칸 이동, 중복 입력 및 스크롤 방지)
function bindMobileButton(btn, direction) {
  if (!btn) return;

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('active');
    movePlayer(direction);
  }, { passive: false });

  const clearActive = (e) => {
    e.preventDefault();
    btn.classList.remove('active');
  };

  btn.addEventListener('pointerup', clearActive, { passive: false });
  btn.addEventListener('pointercancel', clearActive, { passive: false });
  btn.addEventListener('pointerleave', clearActive, { passive: false });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindMobileButton(btnUp, 'up');
bindMobileButton(btnDown, 'down');
bindMobileButton(btnLeft, 'left');
bindMobileButton(btnRight, 'right');

// 시작 및 재시작 버튼 바인딩
if (btnStartEl) {
  btnStartEl.addEventListener('click', (e) => {
    e.preventDefault();
    setGameState('PLAYING');
  });
}

if (btnRestartEl) {
  btnRestartEl.addEventListener('click', (e) => {
    e.preventDefault();
    setGameState('PLAYING');
  });
}

// 충돌 판정 (AABB w/ 격자 기준 유지)
function checkCollision(pX, pY, pSize, car) {
  const margin = 4;
  const pLeft = pX + margin;
  const pRight = pX + pSize - margin;
  const pTop = pY + margin;
  const pBottom = pY + pSize - margin;

  const cLeft = car.x + margin;
  const cRight = car.x + car.width - margin;
  const cTop = car.y + margin;
  const cBottom = car.y + car.height - margin;

  return (
    pLeft < cRight &&
    pRight > cLeft &&
    pTop < cBottom &&
    pBottom > cTop
  );
}

// 게임 업데이트
let lastTime = performance.now();

function update(dt) {
  // 카메라 부드러운 전진 추적 (앞으로만 이동)
  if (camera.y > camera.targetY) {
    camera.y += (camera.targetY - camera.y) * 0.15;
    if (Math.abs(camera.y - camera.targetY) < 0.5) {
      camera.y = camera.targetY;
    }
  }

  // 플레이어 이동 보간 (시각적 점프 애니메이션 처리)
  const targetX = player.targetCol * TILE_SIZE + (TILE_SIZE - player.size) / 2;
  const targetY = getRowWorldY(player.targetRow) + (TILE_SIZE - player.size) / 2;

  if (player.hopProgress < 1) {
    player.hopProgress = Math.min(1, player.hopProgress + dt * 10);
    player.x = player.prevX + (targetX - player.prevX) * player.hopProgress;
    player.y = player.prevY + (targetY - player.prevY) * player.hopProgress;
  } else {
    player.x = targetX;
    player.y = targetY;
  }

  // 행 및 차량 생성/정리
  updateRows();

  // 차량 이동
  for (const [r, rowData] of rows) {
    if (rowData.type === 'road') {
      for (const car of rowData.vehicles) {
        car.x += car.direction * car.speed * dt;

        // 순환 처리 (일정한 간격 유지)
        if (car.direction === 1 && car.x > CANVAS_WIDTH + 60) {
          car.x -= car.loopSpan;
        } else if (car.direction === -1 && car.x < -car.width - 60) {
          car.x += car.loopSpan;
        }

        // 충돌 검사는 PLAYING 상태일 때만 수행
        if (gameState === 'PLAYING') {
          if (checkCollision(player.x, player.y, player.size, car)) {
            setGameState('GAME_OVER', 'CRASH');
          }
        }
      }
    }
  }

  // 화면 아래로 완전히 벗어나면 게임 오버
  if (gameState === 'PLAYING') {
    const playerScreenY = player.y - camera.y;
    if (playerScreenY > CANVAS_HEIGHT) {
      setGameState('GAME_OVER', 'FALL');
    }
  }
}

// 렌더링 함수들
function drawBackground() {
  for (const [r, rowData] of rows) {
    const screenY = rowData.worldY - camera.y;

    // 화면 밖이면 그리기 생략
    if (screenY + TILE_SIZE < 0 || screenY > CANVAS_HEIGHT) continue;

    if (rowData.type === 'grass') {
      // 부드러운 초록색 잔디 타일
      for (let c = 0; c < COLS; c++) {
        const isAlt = (Math.abs(r) + c) % 2 === 0;
        ctx.fillStyle = isAlt ? '#58b368' : '#52a760';
        ctx.fillRect(c * TILE_SIZE, screenY, TILE_SIZE, TILE_SIZE);
      }

      // 잔디 결 장식선
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(0, screenY, CANVAS_WIDTH, 2);
    } else if (rowData.type === 'road') {
      // 짙은 회색 아스팔트 도로
      ctx.fillStyle = '#2f3542';
      ctx.fillRect(0, screenY, CANVAS_WIDTH, TILE_SIZE);

      // 도로 상하단 연석
      ctx.fillStyle = '#1e272e';
      ctx.fillRect(0, screenY, CANVAS_WIDTH, 2);
      ctx.fillRect(0, screenY + TILE_SIZE - 2, CANVAS_WIDTH, 2);

      // 단순한 점선 차선 장식
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 16]);
      ctx.beginPath();
      ctx.moveTo(0, screenY + TILE_SIZE / 2);
      ctx.lineTo(CANVAS_WIDTH, screenY + TILE_SIZE / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 타일 세로 구분선 (은은한 격자)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.035)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * TILE_SIZE, 0);
    ctx.lineTo(c * TILE_SIZE, CANVAS_HEIGHT);
    ctx.stroke();
  }
}

function drawVehicles() {
  for (const [r, rowData] of rows) {
    if (rowData.type === 'road') {
      const screenY = rowData.worldY - camera.y;
      if (screenY + TILE_SIZE < -50 || screenY > CANVAS_HEIGHT + 50) continue;

      for (const car of rowData.vehicles) {
        const cX = car.x;
        const cY = car.y - camera.y;
        const w = car.width;
        const h = car.height;

        // 차량 그림자
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.beginPath();
        ctx.roundRect(cX + 2, cY + 4, w, h, 6);
        ctx.fill();

        // 바퀴 (단순한 직사각형)
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(cX + 8, cY - 2, 10, 3);
        ctx.fillRect(cX + w - 18, cY - 2, 10, 3);
        ctx.fillRect(cX + 8, cY + h - 1, 10, 3);
        ctx.fillRect(cX + w - 18, cY + h - 1, 10, 3);

        // 차체 본체
        ctx.fillStyle = car.color;
        ctx.beginPath();
        ctx.roundRect(cX, cY, w, h, 6);
        ctx.fill();

        // 자동차 캐빈 / 지붕
        ctx.fillStyle = '#2c3e50';
        const cabinX = cX + (w - 32) / 2;
        ctx.beginPath();
        ctx.roundRect(cabinX, cY + 4, 32, h - 8, 4);
        ctx.fill();

        // 자동차 창문 장식 (단순한 도형)
        if (car.direction === 1) {
          // 오른쪽 진행
          ctx.fillStyle = '#74b9ff';
          ctx.fillRect(cabinX + 20, cY + 6, 8, h - 12); // 전면 창문
          ctx.fillStyle = '#dff9fb';
          ctx.fillRect(cabinX + 4, cY + 6, 6, h - 12);  // 후면 창문

          // 전조등 (우측 노랑)
          ctx.fillStyle = '#f9ca24';
          ctx.fillRect(cX + w - 3, cY + 3, 3, 5);
          ctx.fillRect(cX + w - 3, cY + h - 8, 3, 5);

          // 후미등 (좌측 빨강)
          ctx.fillStyle = '#eb4d4b';
          ctx.fillRect(cX, cY + 3, 3, 5);
          ctx.fillRect(cX, cY + h - 8, 3, 5);
        } else {
          // 왼쪽 진행
          ctx.fillStyle = '#74b9ff';
          ctx.fillRect(cabinX + 4, cY + 6, 8, h - 12);  // 전면 창문
          ctx.fillStyle = '#dff9fb';
          ctx.fillRect(cabinX + 22, cY + 6, 6, h - 12); // 후면 창문

          // 전조등 (좌측 노랑)
          ctx.fillStyle = '#f9ca24';
          ctx.fillRect(cX, cY + 3, 3, 5);
          ctx.fillRect(cX, cY + h - 8, 3, 5);

          // 후미등 (우측 빨강)
          ctx.fillStyle = '#eb4d4b';
          ctx.fillRect(cX + w - 3, cY + 3, 3, 5);
          ctx.fillRect(cX + w - 3, cY + h - 8, 3, 5);
        }
      }
    }
  }
}

function drawRobot() {
  const isDead = (gameState === 'GAME_OVER');
  // 이동할 때 짧은 점프 느낌의 시각 효과 (실제 좌표와 충돌 판정은 기존 격자 기준 유지)
  const hopOffset = isDead ? 0 : Math.sin(player.hopProgress * Math.PI) * 9;
  const x = player.x;
  const y = player.y - camera.y - hopOffset;
  const groundY = player.y - camera.y;
  const s = player.size;

  // 지면 그림자 (점프 시 살짝 축소)
  const shadowScale = isDead ? 0.6 : 1 - (hopOffset / 18);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(
    x + s / 2,
    groundY + s - 2,
    (s / 2 - 2) * shadowScale,
    4 * shadowScale,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // 바퀴/트랙
  ctx.fillStyle = '#2f3542';
  ctx.fillRect(x - 2, y + 4, 4, s - 8);
  ctx.fillRect(x + s - 2, y + 4, 4, s - 8);

  // 로봇 본체
  ctx.fillStyle = (isDead && gameOverReason === 'CRASH') ? '#e84118' : '#ff793f';
  ctx.fillRect(x + 2, y + 2, s - 4, s - 4);

  // 상단 안테나
  ctx.strokeStyle = isDead ? '#7f8c8d' : '#d35400';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + s / 2, y + 2);
  ctx.lineTo(x + s / 2, y - 5);
  ctx.stroke();

  ctx.fillStyle = isDead ? '#7f8c8d' : '#ffd32a';
  ctx.beginPath();
  ctx.arc(x + s / 2, y - 6, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 바이저 및 캐릭터 눈 장식
  if (isDead) {
    ctx.fillStyle = '#2f3542';
    ctx.fillRect(x + 6, y + 8, s - 12, 10);

    // 사망 시 눈 (X 표시)
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 10); ctx.lineTo(x + 13, y + 14);
    ctx.moveTo(x + 13, y + 10); ctx.lineTo(x + 9, y + 14);
    ctx.moveTo(x + s - 13, y + 10); ctx.lineTo(x + s - 9, y + 14);
    ctx.moveTo(x + s - 9, y + 10); ctx.lineTo(x + s - 13, y + 14);
    ctx.stroke();
  } else {
    // 정상 시 바이저
    ctx.fillStyle = '#33d9b2';
    ctx.fillRect(x + 6, y + 8, s - 12, 10);

    // 귀여운 캐릭터 눈 (단순한 흰색 사각형 & 동공)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 9, y + 10, 3, 4);
    ctx.fillRect(x + s - 12, y + 10, 3, 4);
  }
}

function render() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawBackground();
  drawVehicles();
  drawRobot();
}

function gameLoop(currentTime) {
  const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;

  update(dt);
  render();

  requestAnimationFrame(gameLoop);
}

// 게임 시작 화면으로 초기화
setGameState('READY');
requestAnimationFrame((time) => {
  lastTime = time;
  gameLoop(time);
});
