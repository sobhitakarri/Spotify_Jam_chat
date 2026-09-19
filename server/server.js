const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const activeRooms = new Map();

io.on('connection', (socket) => {
  const room = socket.handshake.query.room || 'general_jam_room';
  const nickname = socket.handshake.query.nickname || 'Anonymous';

  socket.join(room);
  console.log(`[Jam Chat Server] User "${nickname}" (${socket.id}) joined Jam Room: ${room}`);

  if (!activeRooms.has(room)) {
    activeRooms.set(room, new Set());
  }
  activeRooms.get(room).add(nickname);

  // Broadcast user joined notification to room
  socket.to(room).emit('user-joined', { nickname, activeUsers: Array.from(activeRooms.get(room)) });

  // Relay chat messages
  socket.on('message', (msgData) => {
    console.log(`[Jam Room: ${room}] ${msgData.sender}: ${msgData.text}`);
    // Broadcast to room except sender
    socket.to(room).emit('message', msgData);
  });

  // Relay typing status
  socket.on('typing', (typingData) => {
    socket.to(room).emit('typing', typingData);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[Jam Chat Server] User "${nickname}" disconnected from Jam Room: ${room}`);
    if (activeRooms.has(room)) {
      activeRooms.get(room).delete(nickname);
      if (activeRooms.get(room).size === 0) {
        activeRooms.delete(room);
      }
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeRoomsCount: activeRooms.size });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Spotify Jam Chat Server running on http://localhost:${PORT}`);
});
