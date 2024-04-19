const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String
}, { timestamps: true }); // Enable automatic timestamping

const Contact = mongoose.model('Contact', contactSchema);

module.exports = Contact;
