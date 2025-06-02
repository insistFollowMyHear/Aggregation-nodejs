// 引入 mongoose 
const mongoose = require('mongoose')

// 连接数据库，自动新建 ExpressApi 库
if(process.env.NETWORK === 'testnet') {
    mongoose.connect(process.env.MONGODB_URL, {
        // useNewUrlParser: true, // 避免“不建议使用当前URL字符串解析器”
        // useUnifiedTopology: true,
        authSource: 'admin', // 如果需要指定认证数据库
    })
} else {
    mongoose.connect(process.env.MONGODB_URL, {
        // useNewUrlParser: true, // 避免“不建议使用当前URL字符串解析器”
        // useUnifiedTopology: true,
        authSource: 'admin', // 如果需要指定认证数据库
    })
}

module.exports = mongoose