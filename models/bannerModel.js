const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    required: true,
  },
  cta: {
    type: String,
    required: true,
  },
  bgColor: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    required: true,
  },
  overlay: {
    type: String,
    required: true,
  },
  textColor: {
    type: String,
    required: true,
  },
  status: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

const Banner = mongoose.model('Banner', bannerSchema);

module.exports = Banner;