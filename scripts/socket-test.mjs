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
  socket.on('item_sold', (data) => console.log('[item_sold]', data));
  socket.on('auction_ended', (data) => console.log('[auction_ended]', data));

  socket.on('connect', async () => {
    try {
      const createRes = await fetch(`${BASE}/auctions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: 'test-seller',
          items: [
            { name: 'Item 1', startingPrice: 100 },
            { name: 'Item 2', startingPrice: 50 },
          ],
        }),
      });
      const auction = await createRes.json();
      const auctionId = auction.id;
      console.log('[POST /auctions] created', auctionId);

      const startRes = await fetch(`${BASE}/auctions/${auctionId}/start`, {
        method: 'POST',
      });
      if (!startRes.ok) throw new Error(await startRes.text());
      console.log('[POST /auctions/:id/start] started');

      socket.emit('join_auction', { auctionId });
      setTimeout(() => {
        socket.emit('place_bid', {
          auctionId,
          userId: 'test-user',
          amount: 150,
        });
      }, 100);
      setTimeout(
        () =>
          socket.emit('place_bid', {
            auctionId,
            userId: 'other-user',
            amount: 99,
          }),
        300,
      );
      setTimeout(() => {
        console.log('Done. Disconnect with Ctrl+C.');
      }, 1000);
    } catch (e) {
      console.error(e);
    }
  });
}

main();
