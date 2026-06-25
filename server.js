import http from 'http';
import { WebSocketServer } from 'ws';

const BOARD_SIZE = 19;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'POST' && req.url === '/api/feedback') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body);
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '消息不能为空' }));
          return;
        }
        console.log('[反馈]', new Date().toISOString(), message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '格式错误' }));
      }
    });
    return;
  }

  if (req.url === '/create') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const roomId = String(Math.floor(1000 + Math.random() * 9000));
    res.end(JSON.stringify({ roomId }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, game: 'go-game' }));
  }
});

const wss = new WebSocketServer({ server });
const rooms = {};

function initBoard() {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
}

// ==================== 围棋规则函数（服务端校验） ====================

/** 获取连通块 */
function getGroup(board, row, col) {
  const color = board[row][col];
  if (color === 0) return [];
  const group = [];
  const visited = new Set();
  const queue = [{ row, col }];
  const key = (r, c) => `${r},${c}`;
  visited.add(key(row, col));

  while (queue.length > 0) {
    const p = queue.pop();
    group.push(p);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = p.row + dr;
      const nc = p.col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
      const nk = key(nr, nc);
      if (visited.has(nk)) continue;
      if (board[nr][nc] === color) {
        visited.add(nk);
        queue.push({ row: nr, col: nc });
      }
    }
  }
  return group;
}

/** 计算气数 */
function countLiberties(board, group) {
  const liberties = new Set();
  const key = (r, c) => `${r},${c}`;
  for (const p of group) {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = p.row + dr;
      const nc = p.col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
      if (board[nr][nc] === 0) liberties.add(key(nr, nc));
    }
  }
  return liberties.size;
}

/** 检查是否合法落子（简化版服务端校验） */
function isLegalMove(board, row, col, color, koPoint) {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false;
  if (board[row][col] !== 0) return false;
  if (koPoint && koPoint.row === row && koPoint.col === col) return false;

  const sim = board.map(r => [...r]);
  sim[row][col] = color;
  const myGroup = getGroup(sim, row, col);
  const myLibs = countLiberties(sim, myGroup);
  // 检查是否有提子
  let hasCapture = false;
  const opp = color === 1 ? 2 : 1;
  const checked = new Set();
  const key = (r, c) => `${r},${c}`;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (sim[r][c] !== opp || checked.has(key(r, c))) continue;
      const g = getGroup(sim, r, c);
      for (const p of g) checked.add(key(p.row, p.col));
      if (countLiberties(sim, g) === 0) { hasCapture = true; break; }
    }
    if (hasCapture) break;
  }
  if (myLibs === 0 && !hasCapture) return false;
  return true;
}

/** 广播消息 */
function broadcast(room, data) {
  const msg = JSON.stringify(data);
  room.players.forEach(p => { try { p.ws.send(msg); } catch(e) { console.error('[广播失败]', e.message); } });
}

/** 发送给对手 */
function sendToOpponent(room, player, data) {
  const msg = JSON.stringify(data);
  const opp = room.players.find(p => p.color !== player.color);
  if (opp) {
    try {
      opp.ws.send(msg);
    } catch(e) {
      console.error('[sendToOpponent失败]', data.type || 'unknown', '错误:', e.message, '大小:', msg.length);
    }
  } else {
    console.warn('[sendToOpponent] 未找到对手, 当前玩家数:', room.players.length);
  }
}

// ==================== WebSocket 连接处理 ====================

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room') || '0000';
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: [],
      board: initBoard(),
      currentPlayer: 1,
      moves: [],
      passCount: 0,
      capturedBlack: 0,
      capturedWhite: 0,
      koPoint: null,
      status: 'PLAYING',
    };
  }
  const room = rooms[roomId];

  if (room.players.length >= 2) {
    ws.send(JSON.stringify({ type: 'FULL' }));
    ws.close();
    return;
  }

  const color = room.players.length === 0 ? 1 : 2;
  const player = { color, ws };
  room.players.push(player);
  ws.send(JSON.stringify({ type: 'ASSIGN', color, roomId }));

  if (room.players.length === 2) {
    broadcast(room, { type: 'GAME_START', board: room.board, currentPlayer: 1 });
  } else {
    ws.send(JSON.stringify({ type: 'WAITING', msg: 'Room: ' + roomId }));
  }

  ws.on('message', (raw) => {
    const rawStr = raw.toString();
    const rawSize = rawStr.length;
    // 记录所有非ping消息（不解析，防止JSON.parse丢失）
    if (!rawStr.includes('"ping"')) {
      const preview = rawStr.substring(0, 100);
      const isVc = rawStr.includes('VOICE_SIGNAL');
      console.log(`[MSG-IN] 大小:${rawSize}B VC:${isVc} 预览:${preview}...`);
    }
    try {
      const msg = JSON.parse(rawStr);
      if (msg.type === 'ping') return;

      // ==================== 游戏消息 ====================

      if (msg.type === 'MOVE') {
        const { row, col } = msg;
        if (room.status !== 'PLAYING' || room.currentPlayer !== player.color) return;
        if (!isLegalMove(room.board, row, col, player.color, room.koPoint)) return;

        // 落子
        room.board[row][col] = player.color;
        room.moves.push({ row, col, color: player.color });

        // 提子检查
        const opp = player.color === 1 ? 2 : 1;
        const checked = new Set();
        const key = (r, c) => `${r},${c}`;
        let captured = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            if (room.board[r][c] !== opp || checked.has(key(r, c))) continue;
            const g = getGroup(room.board, r, c);
            for (const p of g) checked.add(key(p.row, p.col));
            if (countLiberties(room.board, g) === 0) {
              for (const p of g) room.board[p.row][p.col] = 0;
              captured += g.length;
            }
          }
        }
        if (opp === 1) room.capturedBlack += captured;
        else room.capturedWhite += captured;

        // 劫判定（简化版：提1子且棋盘恢复上一步状态）
        if (captured === 1 && room.moves.length >= 3) {
          // 检查是否回到两步前的状态
          const prevMove = room.moves[room.moves.length - 3];
          if (prevMove && prevMove.row === row && prevMove.col === col) {
            room.koPoint = { row: prevMove.row, col: prevMove.col };
          } else {
            room.koPoint = null;
          }
        } else {
          room.koPoint = null;
        }

        room.passCount = 0;
        room.currentPlayer = room.currentPlayer === 1 ? 2 : 1;
        broadcast(room, {
          type: 'MOVE',
          row,
          col,
          color: player.color,
          currentPlayer: room.currentPlayer,
          captured,
          koPoint: room.koPoint,
        });
      }

      if (msg.type === 'PASS') {
        if (room.status !== 'PLAYING' || room.currentPlayer !== player.color) return;
        room.passCount++;
        if (room.passCount >= 2) {
          room.status = 'SCORING';
          broadcast(room, { type: 'PASS_RESULT', action: 'SCORING', currentPlayer: room.currentPlayer });
        } else {
          room.currentPlayer = room.currentPlayer === 1 ? 2 : 1;
          broadcast(room, { type: 'PASS_RESULT', action: 'PASS', currentPlayer: room.currentPlayer });
        }
      }

      if (msg.type === 'SURRENDER') {
        const winner = player.color === 1 ? 2 : 1;
        room.status = 'WIN';
        broadcast(room, { type: 'GAME_OVER', winner, winLine: [], reason: 'surrender' });
      }

      if (msg.type === 'DRAW_REQUEST') {
        sendToOpponent(room, player, { type: 'DRAW_REQUEST' });
      }

      if (msg.type === 'DRAW_RESPONSE') {
        if (msg.accept) {
          room.status = 'DRAW';
          broadcast(room, { type: 'GAME_OVER', winner: null, winLine: [], reason: 'draw' });
        } else {
          sendToOpponent(room, player, { type: 'DRAW_REJECTED' });
        }
      }

      if (msg.type === 'UNDO_REQUEST') {
        sendToOpponent(room, player, { type: 'UNDO_REQUEST' });
      }

      if (msg.type === 'UNDO_RESPONSE') {
        if (msg.accept) {
          for (let i = 0; i < 2 && room.moves.length > 0; i++) {
            const m = room.moves.pop();
            room.board[m.row][m.col] = 0;
          }
          room.currentPlayer = 1;
          broadcast(room, { type: 'UNDO_EXECUTED', board: room.board, currentPlayer: room.currentPlayer, moves: room.moves });
        } else {
          sendToOpponent(room, player, { type: 'UNDO_REJECTED' });
        }
      }

      if (msg.type === 'REMATCH_REQUEST') {
        sendToOpponent(room, player, { type: 'REMATCH_REQUEST' });
      }

      if (msg.type === 'REMATCH_RESPONSE') {
        if (msg.accept) {
          room.board = initBoard();
          room.moves = [];
          room.currentPlayer = 1;
          room.passCount = 0;
          room.capturedBlack = 0;
          room.capturedWhite = 0;
          room.koPoint = null;
          room.status = 'PLAYING';
          broadcast(room, { type: 'REMATCH_START' });
        } else {
          sendToOpponent(room, player, { type: 'REMATCH_REJECTED' });
        }
      }

      // ==================== 语音信令转发 ====================

      // ==================== 语音信令转发（simple-peer 统一格式） ====================

      if (msg.type === 'VOICE_SIGNAL') {
        const hasSdp = !!msg.data?.type;
        const hasCandidate = !!msg.data?.candidate;
        const size = JSON.stringify(msg.data || {}).length;
        console.log(`[VOICE_SIGNAL] 来自 P${player.color}, SDP:${hasSdp} ICE:${hasCandidate} 大小:${size}B`);
        sendToOpponent(room, player, { type: 'VOICE_SIGNAL', data: msg.data });
        console.log(`[VOICE_SIGNAL] 已转发给对手`);
      }

      if (msg.type === 'VOICE_HANGUP') {
        sendToOpponent(room, player, { type: 'VOICE_HANGUP' });
      }

      if (msg.type === 'VOICE_MUTE') {
        sendToOpponent(room, player, { type: 'VOICE_MUTE', muted: msg.muted });
      }

    } catch(e) {
      console.error('[消息处理错误]', e);
    }
  });

  ws.on('close', () => {
    room.players = room.players.filter(p => p.ws !== ws);
    if (room.players.length === 0) {
      delete rooms[roomId];
    } else {
      broadcast(room, { type: 'OPPONENT_LEFT' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Go Game WS Server on port ' + PORT));