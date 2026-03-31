const mongoose = require('mongoose');
const crypto = require('crypto');

const reservationSchema = new mongoose.Schema({
    bookingId: { 
        type: String, 
        unique: true 
    },
    userId: { 
        type: String, 
        required: true 
    },
    branch: { type: String, required: true },
    date: { type: String, required: true },
    timeSlots: [String],
    totalPrice: Number,
    // --- ADD THESE TWO FIELDS ---
    isPaid: { 
        type: Boolean, 
        default: false 
    },
    status: { 
        type: String, 
        default: 'Upcoming', 
        enum: ['Upcoming', 'Checked-In', 'Completed', 'Cancelled'] 
    }
});

reservationSchema.pre('save', async function() {
    if (!this.bookingId) {
        const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
        this.bookingId = `PK-${randomHex}`; 
    }
});

module.exports = mongoose.model('Reservation', reservationSchema);