const mongoose = require('mongoose');

const revisionSchema = new mongoose.Schema({
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: String, // 수정 당시의 내용
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Revision', revisionSchema);