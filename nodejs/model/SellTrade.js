// 引入mongodb
const mongoose = require('../db/mongodb')

const SellItemSchema = new mongoose.Schema({
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
    tbc_amount: {
        type: String
    },

});

// 定义主文档 Schema
const SellSchema = new mongoose.Schema({
    sells: [SellItemSchema], // sells 是一个 SellItem 的数组
    ft_total: {
        type: Number
    },
    tbc_total: {
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
const SellTrade = mongoose.model('SellTrade', SellSchema);

module.exports = {SellTrade};