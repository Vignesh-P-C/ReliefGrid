require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/shelters', require('./routes/shelters'));
app.use('/api/aid-requests', require('./routes/aidRequests'));
app.use('/api/supplies', require('./routes/supplies'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`ReliefGrid server running on port ${PORT}`));
