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

// Track room participants
const roomUsers = new Map(); // roomCode -> Map(socketId -> { nickname })

io.on('connection', (socket) => {
  const room = socket.handshake.query.room || 'general_jam_room';
  const nickname = socket.handshake.query.nickname || 'Spotify User';

  socket.join(room);
  
  if (!roomUsers.has(room)) {
    roomUsers.set(room, new Map());
  }
  roomUsers.get(room).set(socket.id, { nickname });

  const currentCount = roomUsers.get(room).size;
  console.log(`[Server] "${nickname}" (${socket.id}) joined room: "${room}". Total in room: ${currentCount}`);

  // Notify everyone in the room of updated presence
  io.to(room).emit('room-presence', {
    room,
    onlineCount: currentCount,
    users: Array.from(roomUsers.get(room).values()).map(u => u.nickname)
  });

  // Relay chat message with server ACK (Sent status ✓)
  socket.on('message', (msgData, callback) => {
    console.log(`[Jam Room: ${room}] ${msgData.sender}: ${msgData.text}`);
    
    // Acknowledge receipt to sender (triggers single tick ✓)
    if (typeof callback === 'function') {
      callback({ status: 'sent', msgId: msgData.id });
    }

    // Broadcast to other users in the room
    socket.to(room).emit('message', msgData);
  });

  // Handle read acknowledgment (triggers double tick ✓✓)
  socket.on('read-ack', (ackData) => {
    socket.to(room).emit('read-ack', ackData);
  });

  // Relay typing indicator
  socket.on('typing', (typingData) => {
    socket.to(room).emit('typing', typingData);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`[Server] User "${nickname}" disconnected from room "${room}"`);
    if (roomUsers.has(room)) {
      roomUsers.get(room).delete(socket.id);
      const remainingCount = roomUsers.get(room).size;
      
      if (remainingCount === 0) {
        roomUsers.delete(room);
      } else {
        io.to(room).emit('room-presence', {
          room,
          onlineCount: remainingCount,
          users: Array.from(roomUsers.get(room).values()).map(u => u.nickname)
        });
      }
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeRoomsCount: roomUsers.size });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Spotify Jam Chat Server running on port ${PORT}`);
});
