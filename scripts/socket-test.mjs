/**
 * Manual Socket.IO test. Run with: node scripts/socket-test.mjs
 * Start the server first in another terminal: npm run start:dev
 */
import { io } from 'socket.io-client';

const BASE = 'http://localhost:3000';

async function main() {
  try {
    const ping = await fetch(`${BASE}/health`);
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch (e) {
    console.error('[ERR] Cannot reach server at', BASE);
    console.error(
      'Start the server first in another terminal: npm run start:dev',
    );
    process.exit(1);
  }

  const socket = io(BASE, { autoConnect: true });

  socket.on('connect', () => console.log('[OK] Connected to', BASE));
  socket.on('connect_error', (err) => {
    console.error('[ERR] Socket failed', err.message);
    process.exit(1);
  });
  socket.on('auction_state', (state) => console.log('[auction_state]', state));
  socket.on('bid_result', (result) => console.log('[bid_result]', result));

  socket.on('connect', async () => {
    try {
      const res = await fetch(`${BASE}/auctions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startingPrice: 100 }),
      });
      const startResult = await res.json();
      console.log('[POST /auctions/start]', startResult);

      socket.emit('place_bid', { userId: 'test-user', amount: 150 });
      setTimeout(
        () => socket.emit('place_bid', { userId: 'other-user', amount: 99 }),
        200,
      );
      setTimeout(() => {
        console.log('Done. Disconnect with Ctrl+C.');
      }, 500);
    } catch (e) {
      console.error(e);
    }
  });
}

main();
