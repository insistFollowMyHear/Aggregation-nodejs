// 引入mongodb
const mongoose = require('../db/mongodb')

// 定义 交易失败 Schema
const TradeErrorSchema = new mongoose.Schema({
    hash: { // 交易hash
        type: String
    },
    kind: {
        type: String, // BUY ,SELL
    },
    errorCode: {  //1:聚合交易失败或未进行聚合交易->执行退款 2：转账分发失败 ->执行转账分发
        type: Number
    },
    errorMsg: {
        type: String
    },
    retries: {  // 只进行一次 
        type: Number
    },
    tx: { // 退款或者转账hash
        type: String
    },
    status: {  // 0:未处理 1:已处理
        type: Number
    },
    createTime: {
        type: Date,
        default: Date.now,
        index: true
    },
});

// 创建模型
const TradeError = mongoose.model('TradeError', TradeErrorSchema);

module.exports = {TradeError};