const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: String,  // Add this
    //username: String,  // Add this
    userId: { type: String, unique: true },
    phone: String,      // Add this
    isAdmin: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema);