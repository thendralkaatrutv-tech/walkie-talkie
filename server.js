const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const users = new Map();
const channels = new Map();
channels.set('general', { name: 'General', users: new Set() });

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join', (data) => {
        const { nickname, channel = 'general' } = data;
        users.set(socket.id, {
            id: socket.id,
            nickname: nickname || 'Anonymous',
            channel: channel,
            isTalking: false
        });
        socket.join(channel);
        if (!channels.has(channel)) {
            channels.set(channel, { name: channel, users: new Set() });
        }
        channels.get(channel).users.add(socket.id);
        socket.to(channel).emit('user-joined', {
            id: socket.id,
            nickname: nickname || 'Anonymous'
        });
        const channelUsers = [];
        channels.get(channel).users.forEach(userId => {
            if (users.has(userId) && userId !== socket.id) {
                channelUsers.push(users.get(userId));
            }
        });
        socket.emit('channel-users', channelUsers);
        console.log(`${nickname} joined channel: ${channel}`);
    });
    
    socket.on('offer', (data) => {
        const { targetId, offer } = data;
        const user = users.get(socket.id);
        if (user) {
            io.to(targetId).emit('offer', {
                senderId: socket.id,
                senderNickname: user.nickname,
                offer: offer
            });
        }
    });
    
    socket.on('answer', (data) => {
        const { targetId, answer } = data;
        io.to(targetId).emit('answer', {
            senderId: socket.id,
            answer: answer
        });
    });
    
    socket.on('ice-candidate', (data) => {
        const { targetId, candidate } = data;
        io.to(targetId).emit('ice-candidate', {
            senderId: socket.id,
            candidate: candidate
        });
    });
    
    socket.on('ptt-pressed', () => {
        const user = users.get(socket.id);
        if (user) {
            user.isTalking = true;
            socket.to(user.channel).emit('user-talking', {
                id: socket.id,
                nickname: user.nickname,
                status: 'talking'
            });
        }
    });
    
    socket.on('ptt-released', () => {
        const user = users.get(socket.id);
        if (user) {
            user.isTalking = false;
            socket.to(user.channel).emit('user-talking', {
                id: socket.id,
                nickname: user.nickname,
                status: 'idle'
            });
        }
    });
    
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            if (channels.has(user.channel)) {
                channels.get(user.channel).users.delete(socket.id);
            }
            socket.to(user.channel).emit('user-left', {
                id: socket.id,
                nickname: user.nickname
            });
            users.delete(socket.id);
            console.log('User disconnected:', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Walkie-Talkie Server running on http://localhost:${PORT}`);
});
