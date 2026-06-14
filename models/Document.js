const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    lastModified: { type: Date, default: Date.now },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
    password: { type: String, default: null },
    
    // --- 프라이빗 기능 추가 필드 ---
    isPrivate: { type: Boolean, default: false }, // 기본은 공개로 설정
    allowedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] 
    
});

module.exports = mongoose.model('Document', documentSchema);