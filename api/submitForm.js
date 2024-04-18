const mongoose = require('mongoose');
const { connectToDatabase } = require('../utils/mongodb'); // adjust path as necessary

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await connectToDatabase();

    const Contact = mongoose.model('Contact', new mongoose.Schema({
      firstName: String,
      lastName: String,
      email: String
    }));

    const { first_name, last_name, email } = req.body;
    const newContact = new Contact({ firstName: first_name, lastName: last_name, email: email });
    await newContact.save();

    res.status(303).redirect('https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Database connection or operation failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
