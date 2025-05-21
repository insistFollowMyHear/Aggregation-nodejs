// 引入mongodb
const mongoose = require('../db/mongodb')
// 建立用户表
const TxSchema = new mongoose.Schema({
    pool: {
        type: String,
    },
    hash: {
        type: String,
        unique: true
    },
    address: {
        type: String,
    },
    kind: {
        type: String,
    },
    amount: {
        type: String,
    },
    slide: {
        type: Number,
    },
    createTime: {
        type: Date,
        default: Date.now
    },
    updateTime: {
        type: Date,
        default: Date.now
    }
})

// 建立用户数据库模型
const Tx = mongoose.model('Tx', TxSchema)
module.exports = { Tx }