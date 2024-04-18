const mongoose = require('mongoose');

const connectToDatabase = async () => {
    const dbURI = process.env.MONGODB_URI;
    if (!dbURI) {
        throw new Error('MongoDB connection string is missing in the environment variables.');
    }

    try {
        const conn = await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`MongoDB Connection Error: ${err.message}`);
        throw err; // Rethrow the error for the caller to handle
    }
};

module.exports = { connectToDatabase };
