const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: {
    type: String,
    unique: true // Ensure the email is unique to consolidate repeat entries
  },
  updateCount: {
    type: Number,
    default: 0 // Starts at 0 and increments with each update
  }
}, { timestamps: true });

const Contact = mongoose.model('Contact', contactSchema);

module.exports = Contact;
