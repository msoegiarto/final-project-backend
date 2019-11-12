require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const PORT = process.env.PORT || 5000;
const routes = require('./routes/index');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  limits: { fileSize: 100000 },
}));
app.use(cors());

// environment variables validation
if (!process.env.MONGO_URI)
  throw new Error('Please set/export the following environment variable: MONGO_URI');
if (!process.env.AUTH0_DOMAIN)
  throw new Error('Please set/export the following environment variable: AUTH0_DOMAIN');
if (!process.env.AUTH0_AUDIENCE)
  throw new Error('Please set/export the following environment variable: AUTH0_AUDIENCE');
if (!process.env.MS_TRANSLATION_TEXT_SUBSCRIPTION_KEY)
  throw new Error('Please set/export the following environment variable: MS_TRANSLATION_TEXT_SUBSCRIPTION_KEY');
if (!process.env.MS_TRANSLATION_TEXT_ACCESS_TOKEN_URL)
  throw new Error('Please set/export the following environment variable: MS_TRANSLATION_TEXT_ACCESS_TOKEN_URL');
if (!process.env.MS_TRANSLATION_TEXT_BASE_URL)
  throw new Error('Please set/export the following environment variable: MS_TRANSLATION_TEXT_BASE_URL');

// Connect to Mongo
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true
})
  .then(() => console.log('MongoDB connected...'))
  .catch(err => console.error(err));

routes(app);

if (process.env.NODE_ENV === 'production') {
  //Static file declaration
  app.use(express.static(path.join(__dirname, '../client/build')));
  //build mode 
  app.get('*', (req, res) => { res.sendfile(path.join(__dirname = '../client/build/index.html')); })
} else {
  app.get('*', (req, res) => res.json({ msg: `Welcome to ${req.hostname}` }));
}

app.listen(PORT, () => console.log(`Server started on port ${PORT}...`));