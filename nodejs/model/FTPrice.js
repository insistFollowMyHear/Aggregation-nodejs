// 引入mongodb
const mongoose = require('../db/mongodb')

// 定义 BuyItem 子文档 Schema
const FTPriceSchema = new mongoose.Schema({
    ft: {
        type: String
    },
    kind: {
        type: String,
    },
    ft_amount: {
        type: Number
    },
    tbc_amout: {
        type: Number
    },
    price: {
        type: Number
    },
    createTime: {
        type: Date,
        default: Date.now,
        index: true
    },
});

// 创建模型
const FTPrice = mongoose.model('FTPrice', FTPriceSchema);

module.exports = {FTPrice};