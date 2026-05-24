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

const URL_PASSWORD = process.env.URL_PASSWORD || 'walkie123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const sessions = new Set();
const users = new Map();
const channels = new Map();
channels.set('general', { name: 'General', users: new Set() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/auth', (req, res) => {
    const { password } = req.body;
    if (password === URL_PASSWORD) {
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        sessions.add(token);
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/auth') {
        return next();
    }
    
    const token = req.query.token || req.headers['x-auth-token'];
    if (token && sessions.has(token)) {
        return next();
    }
    
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/login');
    }
    
    if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.startsWith('/socket.io')) {
        return next();
    }
    
    res.status(401).send('Unauthorized');
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join', (data) => {
        const { nickname, channel = 'general', isAdmin, adminPassword } = data;
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
    
    socket.on('chat-message', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        
        const { text, channel } = data;
        if (!text || !text.trim()) return;
        
        io.to(channel).emit('chat-message', {
            senderId: socket.id,
            nickname: user.nickname,
            isAdmin: user.isAdmin,
            text: text.trim(),
            timestamp: Date.now()
        });
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
    
    socket.on('mute-user', (data) => {
        const admin = users.get(socket.id);
        if (!admin || !admin.isAdmin) return;
        const { targetId } = data;
        io.to(targetId).emit('muted', { muted: true });
        io.to(admin.channel).emit('user-muted', { id: targetId, muted: true });
    });
    
    socket.on('unmute-user', (data) => {
        const admin = users.get(socket.id);
        if (!admin || !admin.isAdmin) return;
        const { targetId } = data;
        io.to(targetId).emit('muted', { muted: false });
        io.to(admin.channel).emit('user-muted', { id: targetId, muted: false });
    });
    
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            if (channels.has(user.channel)) {
                channels.get(user.channel).users.delete(socket
