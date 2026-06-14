const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    inviteCode: { type: String, required: true, unique: true }, // 초대 코드
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 방장
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // 참여자 목록
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Room', roomSchema);