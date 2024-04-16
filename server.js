const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const connectDB = require('./utils/mongodb'); // Ensure this path is correct

const app = express();
app.use(bodyParser.json());
connectDB();

app.use(express.static('public')); // Serve static files

// Existing routes and middleware
// app.get('/', (req, res) => {
//   res.send('Hello World!');
// });

// New form submission endpoint
app.post('/popstart', async (req, res) => {
  const { first_name, last_name, email } = req.body;
  try {
    // Assuming a Mongoose model for your form data
    const newContact = new Contact({
      firstName: first_name,
      lastName: last_name,
      email: email
    });
    await newContact.save();
    res.redirect('/popstart');
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).send('Error processing your request');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
