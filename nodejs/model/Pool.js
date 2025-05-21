// 引入mongodb
const mongoose = require('../db/mongodb')
const { Token, TokenSchema } = require('./Token');

// 建立用户表
const PoolSchema = new mongoose.Schema({
    poolId: {
        type: String,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    token0: {
        type: new mongoose.Schema({
            ...TokenSchema.obj,
            contractId: { type: String, required: true }
        }),
        required: true
    },
    token1: {
        type: new mongoose.Schema({
            ...TokenSchema.obj, // 复制 TokenSchema 的对象结构
            contractId: { type: String, required: true } // 覆盖 contractId 字段
        })
    },
    fee: {
        type: Number,
        required: true
    }
})

// 建立用户数据库模型
const Pool = mongoose.model('Pool', PoolSchema)
module.exports = { Pool }