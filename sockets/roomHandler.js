// sockets/roomHandler.js
const Room = require('../models/Room');

module.exports = (io) => {
    io.on('connection', (socket) => {
        socket.on('join-room', async (roomId, userId) => {
            const room = await Room.findById(roomId);
            
            // 룸 멤버인지 확인
            if (room && room.members.includes(userId)) {
                socket.join(roomId);
                console.log(`User ${userId} joined room ${roomId}`);
            } else {
                socket.emit('error', '입장 권한이 없습니다.');
            }
        });
    });
};