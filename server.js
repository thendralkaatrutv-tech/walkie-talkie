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

// ===== URL PASSWORD PROTECTION =====
const URL_PASSWORD = process.env.URL_PASSWORD || 'walkie123';
// ===================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const users = new Map();
const channels = new Map();
channels.set('general', { name: 'General', users: new Set() });

// Middleware to check URL password
app.use((req, res, next) => {
    // Skip check for login page and auth endpoints
    if (req.path === '/login' || req.path === '/auth' || req.path.startsWith('/login.html')) {
        return next();
    }
    
    // Check if user has valid session
    if (req.session && req.session.authenticated) {
        return next();
    }
    
    // Check custom header or query token (for socket.io static files)
    const authToken = req.headers['x-auth-token'] || req.query.token;
    if (authToken === URL_PASSWORD) {
        return next();
    }
    
    // Redirect to login
    res.redirect('/login');
});

// Parse JSON and serve static with session-like behavior using cookies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple cookie-based auth (no session store needed)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/auth', (req, res) => {
    const { password } = req.body;
    if (password === URL_PASSWORD) {
        res.cookie('auth', URL_PASSWORD, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

// Middleware to check cookie auth for static files
app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/auth' || req.path.startsWith('/login.html')) {
        return next();
    }
    
    const cookie = req.headers.cookie;
    if (cookie && cookie.includes(`auth=${URL_PASSWORD}`)) {
        return next();
    }
    
    res.redirect('/login');
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
    console.log(`Walkie-Talkie Server running on port ${PORT}`);
    console.log(`URL password: ${URL_PASSWORD}`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
