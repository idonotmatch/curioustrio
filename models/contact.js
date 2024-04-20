const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String
}, { timestamps: true });

// Check if the model already exists, use it. If not, compile a new one.
const Contact = mongoose.models.Contact || mongoose.model('Contact', contactSchema);

module.exports = Contact;
