const cron = require('node-cron');
const userService = require('../services/userService');
const {poolBackend} = require("../services/poolBackend");

// 定义定时任务，每天凌晨 2 点执行
cron.schedule('*/5 * * * * *', async () => {
    console.log('Running aggregation job...');
    const poolNftContractId = '92bf2ffb337b901bd46974ebc2884207d37cfac77ebbd80ca84650aeea7dd484'
    const poolUse = new poolBackend(poolNftContractId)
    await poolUse.initfromContractId()

    try {
        // 调用服务层函数来执行业务逻辑
        await userService.doAggregation(poolUse);
        console.log('Aggregation completed: ', new Date());
    } catch (err) {
        console.error('Error during aggregation:', err);
    }
});