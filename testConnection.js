require('dotenv').config(); // Ensure this is at the top to load the environment variables

const mongoose = require('mongoose');

async function testConnection() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('Connection to MongoDB successful');
        mongoose.disconnect();
    } catch (error) {
        console.error('Failed to connect to MongoDB', error);
    }
}

testConnection();
