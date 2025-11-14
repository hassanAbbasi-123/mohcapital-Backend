const categoryModel = require("./categoryModel");
const productModel = require("./productModel");
const User = require("./userModel");
const SellerProfile = require("./sellerProfile");
const Brand=require("./brandModel");
const coupon=require("./couponModel");
const wishlist =require("./wishlistModel");
const conversation=require("./chatmodel/conversationModel");
const message=require("./chatmodel/messageModel");
const SubOrder=require("./ordermodel/subOrderModel");
const Order=require("./ordermodel/orderModel");
const Dispute=require("./ordermodel/disputeModel");
const ReturnRequest=require("./ordermodel/returnModel");
module.exports = {
     User,
    categoryModel,
    SellerProfile,
    productModel,
    Brand,
    coupon,
    wishlist,
    conversation,
    message,
    SubOrder,
    Order,
    Dispute,
    ReturnRequest,
    
    };