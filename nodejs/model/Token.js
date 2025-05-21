// 引入mongodb
const mongoose = require('../db/mongodb')
// 建立用户表
const TokenSchema = new mongoose.Schema({
    contractId: {
        type: String,
        unique: true,
        required: true
    },
    name: {
        type: String
    },
    symbol: {
        type: String
    },
    decimal: {
        type: Number
    },
    icon: {
        type: String,
    }
})

// 建立用户数据库模型
const Token = mongoose.model('Token', TokenSchema)
module.exports = { Token, TokenSchema }