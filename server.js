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

// ===== ADMIN CONFIG =====
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
// ========================

const users = new Map();
const channels = new Map();
channels.set('general', { name: 'General', users: new Set() });

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (data) => {
        const { nickname, channel = 'general', isAdmin, adminPassword } = data;

        // Validate admin password if claiming admin
        let userIsAdmin = false;
        if (isAdmin) {
            if (adminPassword !== ADMIN_PASSWORD) {
                socket.emit('join-error', { message: 'Invalid admin password' });
                return;
            }
            userIsAdmin = true;
        }

        users.set(socket.id, {
            id: socket.id,
            nickname: nickname || 'Anonymous',
            channel: channel,
            isTalking: false,
            isAdmin: userIsAdmin
        });

        socket.join(channel);

        if (!channels.has(channel)) {
            channels.set(channel, { name: channel, users: new Set() });
        }
        channels.get(channel).users.add(socket.id);

        socket.to(channel).emit('user-joined', {
            id: socket.id,
            nickname: nickname || 'Anonymous',
            isAdmin: userIsAdmin
        });

        const channelUsers = [];
        channels.get(channel).users.forEach(userId => {
            if (users.has(userId) && userId !== socket.id) {
                channelUsers.push(users.get(userId));
            }
        });

        socket.emit('join-success', {
            users: channelUsers,
            isAdmin: userIsAdmin
        });

        console.log(`${nickname} joined channel: ${channel} ${userIsAdmin ? '(ADMIN)' : ''}`);
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

    // Admin: kick user
    socket.on('kick-user', (data) => {
        const admin = users.get(socket.id);
        if (!admin || !admin.isAdmin) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
        }

        const { targetId } = data;
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.emit('kicked', { message: 'You have been kicked by admin' });
            targetSocket.disconnect(true);
        }
    });

    // Admin: mute user
    socket.on('mute-user', (data) => {
        const admin = users.get(socket.id);
        if (!admin || !admin.isAdmin) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
        }

        const { targetId } = data;
        io.to(targetId).emit('muted', { muted: true });
        io.to(admin.channel).emit('user-muted', { id: targetId, muted: true });
    });

    // Admin: unmute user
    socket.on('unmute-user', (data) => {
        const admin = users.get(socket.id);
        if (!admin || !admin.isAdmin) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
        }

        const { targetId } = data;
        io.to(targetId).emit('muted', { muted: false });
        io.to(admin.channel).emit('user-muted', { id: targetId, muted: false });
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
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
