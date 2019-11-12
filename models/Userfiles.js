const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Create Schema
const UserfilesSchema = new Schema({
  data: {
    type: Buffer,
    required: true
  },
  content_type: {
    type: String,
    required: true
  },
  file_name: {
    type: String,
    trim: true,
    required: true,
    unique: true
  },
  lang_from: {
    type: String,
    trim: true,
    required: true
  },
  lang_to: {
    type: String,
    trim: true,
    required: true
  },
  char_length: {
    type: Number
  },
  is_active: {
    type: Boolean,
    default: true
  },
  create_date: {
    type: Date,
    default: Date.now
  },
  // expiry_date is set 30 days from Date.now
  expiry_date: {
    type: Date,
    default: () => Date.now() + 30 * 24 * 60 * 60 * 1000
  },
  file_owner: {
    type: Schema.Types.ObjectId,
    ref: 'Users'
  }
});

module.exports = Userfiles = mongoose.model('Userfiles', UserfilesSchema);