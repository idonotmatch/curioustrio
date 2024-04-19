require('dotenv').config({ path: './.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const connectDB = require('./utils/mongodb');
const Contact = require('./models/contact'); // Ensure the path is correct based on your project structure

const app = express();
app.use(bodyParser.json());

connectDB().then(() => {
  console.log('MongoDB connected successfully');
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
  process.exit(1);
});

app.post('/submit-form', async (req, res) => {
  const { first_name, last_name, email } = req.body;
  try {
    const newContact = new Contact({
      firstName: first_name,
      lastName: last_name,
      email: email
    });
    await newContact.save();
    res.redirect(303, 'https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).send('Error processing your request');
  }
});

app.use((req, res) => {
  res.status(404).send('Page not found');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
