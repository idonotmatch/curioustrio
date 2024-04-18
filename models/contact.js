const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String
});

// Use mongoose.model's third argument to prevent model recompilation if it already exists
module.exports = mongoose.model('Contact', contactSchema, 'Contact');
