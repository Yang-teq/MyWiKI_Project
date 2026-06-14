const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
    docId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    content: { type: String },
    modifiedAt: { type: Date, default: Date.now },
    editor: { type: String }
});

module.exports = mongoose.model('History', historySchema);