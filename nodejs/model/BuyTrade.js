// 引入mongodb
const mongoose = require('../db/mongodb')

// 定义 BuyItem 子文档 Schema
const BuyItemSchema = new mongoose.Schema({
    address: {
        type: String
    },
    amount: {
        type: Number
    },
    slideAmount: {
        type: Number
    },
    slide: {
        type: Number
    },
    hash: {
        type: String
    },
    tx: {
        type: String
    },
    ft_amount: {
        type: String
    },
});

// 定义主文档 Schema
const BuySchema = new mongoose.Schema({
    buys: [BuyItemSchema], // buys 是一个 BuyItem 的数组
    tbc_total: {
        type: Number
    },
    ft_total: {
        type: Number
    },
    raw: {
        type: String
    },
    createTime: {
        type: Date,
        default: Date.now
    },
});

// 创建模型
const BuyTrade = mongoose.model('BuyTrade', BuySchema);

module.exports = {BuyTrade};