const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true } // 실제로는 암호화해서 저장해야 합니다
});

module.exports = mongoose.model('User', userSchema);