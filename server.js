const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const connectDB = require('./utils/mongodb'); // Check this path is correct

const app = express();
app.use(bodyParser.json());
connectDB();

// Serve static files - make sure 'public' directory has correct permissions and files
app.use(express.static('public'));

// Define a model for the contact if not already defined
const Contact = mongoose.model('Contact', new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String
}));

// POST route for form submission
app.post('/submit-form', async (req, res) => {
  const { first_name, last_name, email } = req.body;
  try {
    const newContact = new Contact({
      firstName: first_name,
      lastName: last_name,
      email: email
    });
    await newContact.save();
    res.redirect('https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).send('Error processing your request');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
