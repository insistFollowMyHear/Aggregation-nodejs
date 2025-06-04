const { Tx } = require('../model/Tx')
const {poolEx} = require("./poolEx");
const {poolF} = require("./pool");
const redis = require('../db/redis')
const {Token} = require("../model/Token");
const {Pool} = require("../model/Pool");
const {FTPrice} = require("../model/FTPrice");
const {BuyTrade} = require('../model/BuyTrade');
const {SellTrade} = require('../model/SellTrade');
const {API, FT} = require("tbc-contract");
const tbc = require("tbc-lib-js");
const { logInfoWithTimestamp, logErrWithTimestamp, logWarnWithTimestamp } = require('../tools/log');

const network= process.env.NETWORK || 'testnet';
global.globalMap = new Map();

exports.doAggregation = async (poolUse) => {
    // console.log(await poolUse.getSwaptoTBC(1))
};

exports.buy = async (data) => {
    logInfoWithTimestamp('buy tx:', data.hash)
    const pool = await GetPool(data.pool, data.lpPlan, data.ft_contract_id)
    const balance = await pool.getTBCTX(data.hash)
    if (balance instanceof Error) {
        throw balance;
    }
    logInfoWithTimestamp('buy:', data)
    await Tx.create({
        pool: data.pool,
        hash: data.hash,
        kind: '1',
        address: data.address,
        amount: balance,
        slide: data.slide,
        ft_contract_id: data.ft_contract_id
    })
    await pool.swaptoTokens(data.hash, data.address, balance, data.slide)
};

exports.sell = async (data) => {
    logInfoWithTimestamp('sell tx:', data.hash)
    const pool = await GetPool(data.pool, data.lpPlan, data.ft_contract_id)
    const balance = await pool.getFTTX(data.hash)
    if (balance instanceof Error) {
        throw balance;
    }
    logInfoWithTimestamp('sell:', data)
    await Tx.create({
        pool: data.pool,
        hash: data.hash,
        kind: '2',
        address: data.address,
        amount: balance,
        slide: data.slide,
        ft_contract_id: data.ft_contract_id
    })
   await pool.swaptoTBCs(data.hash, data.address, balance, data.slide)


    // const poolUse = new poolF({txidOrParams: data.pool, network:network})
    // await poolUse.initfromContractId()
    // console.log(await poolUse.getLPBalance('143KgKGcse57nXBnXyJwtQrf2KP4KWto59'))
    // console.log(await poolUse.getConsumLP(1))
    // console.log(await poolUse.getPool('143KgKGcse57nXBnXyJwtQrf2KP4KWto59'))
    // console.log(await poolUse.getSwaptoToken(1))
    // console.log(await poolUse.getSwaptoTBC(1))

    // const privateKeyA = tbc.PrivateKey.fromString('L58BF55NBREwGyvhY7ko5VDsw4SXva7wyK4qZRN1oWKRG9S1ezUb')
    // const addressA = tbc.Address.fromPrivateKey(privateKeyA).toString()
    // const utxo = await API.fetchUTXO(privateKeyA, 1.01, network);
    // const txraw = await pool.swaptoTBC_baseToken(privateKeyA, addressA, utxo, 1)
    // const raw = await API.broadcastTXraw(txraw, network)
    //
    // console.log('swaptoToken:', raw)

    // const privateKeyA = tbc.PrivateKey.fromString('L58BF55NBREwGyvhY7ko5VDsw4SXva7wyK4qZRN1oWKRG9S1ezUb')
    // const addressA = tbc.Address.fromPrivateKey(privateKeyA).toString()
    // const address = '143KgKGcse57nXBnXyJwtQrf2KP4KWto59'
    // const transferTokenAmount = 500;//转移数量
    // const Token = new FT('8ad595b8c2f624373d4fb43b9924eaea2f03544ab6bc2f07606baa3b99ddb5f3');
    // const TokenInfo = await API.fetchFtInfo(Token.contractTxid, network);//获取FT信息
    // Token.initialize(TokenInfo);
    // const utxo = await API.fetchUTXO(privateKeyA, 0.01, network);//准备utxo
    // const transferTokenAmountBN = BigInt(transferTokenAmount * Math.pow(10, Token.decimal));
    // const ftutxo_codeScript = FT.buildFTtransferCode(Token.codeScript, addressA).toBuffer().toString('hex');
    // const ftutxos = await API.fetchFtUTXOs(Token.contractTxid, addressA, ftutxo_codeScript, network, transferTokenAmountBN);//准备ft utxo
    // let preTXs  = [];
    // let prepreTxDatas  = [];
    // for (let i = 0; i < ftutxos.length; i++) {
    //     preTXs.push(await API.fetchTXraw(ftutxos[i].txId, network));//获取每个ft输入的父交易
    //     prepreTxDatas.push(await API.fetchFtPrePreTxData(preTXs[i], ftutxos[i].outputIndex, network));//获取每个ft输入的爷交易
    // }
    // const transferTX = Token.transfer(privateKeyA, address, transferTokenAmount, ftutxos, utxo, preTXs, prepreTxDatas);//组装交易
    // await API.broadcastTXraw(transferTX, network);
};

exports.GetTokens = async () => {
    // await Token.create({
    //     contractId: "e62718dadec4eeff66eb72765e63357131cc036fe428e48f13128173c18d1e20",
    //     name: "test_b",
    //     symbol: "test_b",
    //     decimal: 6,
    //     icon: "",
    // })
    return await Token.find()
};

exports.GetPair = async (data) => {
    const pair = await Pool.findOne({ 'token0.contractId': data.contractId})
    if(!pair) {
        throw new Error(`No pool found with contractId: ${data.contractId}`);
    }
    return pair
};

exports.GetLog = async (data) => {
    const result = await BuyTrade.find(
        { 'buys.hash': data.hash }, // 查询条件
    );
    if (result.length === 0) {
        const result = await SellTrade.find(
            { 'sells.hash': data.hash }, // 查询条件
        );
        return result
    }
    return result
};

exports.GetPrice = async (data) => {
    let queryConditions = { ft: data.ft };
    let timeInterval;

    if (data.interval > 0) {
        timeInterval = new Date(new Date().getTime() - data.interval * 60 * 1000);
        queryConditions.createTime = { $gte: timeInterval };
    }

    return await FTPrice.find(queryConditions)
        .sort({ createTime: -1 })
        .limit(300);
};

exports.getPricePara = async (data) => {
    const now = new Date();
    // 计算当前时间的整点
    const currentTime = new Date(Math.floor(now.getTime() / (data.interval * 60 * 1000)) * (data.interval * 60 * 1000)); // 向下舍入到最近的整点（每小时）

    // 查询数据库获取每个小时的最大、最小、开盘、收盘
    const pipeline = [
        {
            $project: {
                ft: 1,
                price: 1,
                createTime: 1,
                timeWindow: {
                    $dateToString: {
                        format: "%Y-%m-%dT%H:00:00",  // 格式化为每小时的开始时间
                        date: {
                            $subtract: [
                                "$createTime",
                                { $mod: [{ $toLong: "$createTime" }, data.interval * 60 * 1000] } // 计算小时级别的时间窗口
                            ]
                        }
                    }
                }
            }
        },
        {
            $group: {
                _id: "$timeWindow",  // 按小时时间分组
                open: { $first: "$price" },  // 开盘价（窗口内的第一个价格）
                close: { $last: "$price" },  // 收盘价（窗口内的最后一个价格）
                high: { $max: "$price" },    // 最高价（窗口内的最大价格）
                low: { $min: "$price" },     // 最低价（窗口内的最小价格）
                price: { $first: "$price" }, // 任意价格（仅用于获取价格）
                createTime: { $first: "$createTime" }
            }
        },
        {
            $sort: { "_id": -1 }  // 按时间升序排序
        }
    ];

    try {
        // 获取聚合结果
        const result = await FTPrice.aggregate(pipeline);

        // 计算时间范围（开始和结束时间）
        const firstRecord = result[0];
        const lastRecord = result[result.length - 1];
        const startTime = new Date(firstRecord._id);
        const endTime = new Date(lastRecord._id);

        // 生成从当前时间开始的每小时时间窗口
        const timeSeries = [];
        let currentTimeWindow = new Date(currentTime);
        const roundedEndTimeTime = new Date(Math.ceil(endTime.getTime() / (data.interval * 60 * 1000)) * (data.interval * 60 * 1000));

        while (currentTimeWindow >= roundedEndTimeTime) {
            timeSeries.push(currentTimeWindow.toISOString().substring(0, 13) + ":00:00");  // 格式化时间为 YYYY-MM-DDTHH:00:00
            currentTimeWindow = new Date(currentTimeWindow.getTime() - data.interval * 60 * 1000); // 增加 1 小时
        }

        // 填充缺失的时间段
        const filledData = [];
        let dataIndex = 0;

        timeSeries.forEach((timeWindow, index) => {
            // 如果存在数据，则直接加入
            if (dataIndex < result.length && result[dataIndex]._id === timeWindow) {
                filledData.push(result[dataIndex]);
                dataIndex++;
            } else {
                // 如果没有数据，使用前后数据填充
                let prevData = null;
                let nextData = null;

                // 查找前一个有效数据
                if (index > 0 && filledData[index - 1]) {
                    prevData = filledData[index - 1];
                }

                // 查找后一个有效数据
                if (dataIndex < result.length) {
                    nextData = result[dataIndex];
                }

                // 如果既有前一个有效数据，也有后一个有效数据
                if (prevData && nextData) {
                    filledData.push({
                        open: nextData.close,
                        close: prevData.close,
                        high: Math.max(prevData.high, nextData.high),
                        low: Math.min(prevData.low, nextData.low),
                        createTime: timeWindow
                    });
                }
                // 如果只有前一个数据
                else if (prevData) {
                    filledData.push({
                        open: prevData.close,
                        close: prevData.close,
                        high: prevData.high,
                        low: prevData.low,
                        createTime: timeWindow
                    });
                }
                // 如果只有后一个数据
                else if (nextData) {
                    filledData.push({
                        open: nextData.close,
                        close: nextData.close,
                        high: nextData.high,
                        low: nextData.low,
                        createTime: timeWindow
                    });
                }
            }
        });

        return filledData;
    } catch (error) {
        console.error("Error in aggregation:", error);
        return [];
    }
}

exports.SetPair = async (data) => {
    const pool = await GetPool(data.poolId, data.lpPlan, data.ft_contract_id)
    const TokenInfo = await API.fetchFtInfo(pool.ft_a_contractTxid, network);//获取FT信息
    await Pool.create({
            poolId: data.poolId,
            name: data.name,
            token0: {
                contractId: pool.ft_a_contractTxid,
                name: TokenInfo.name,
                symbol: TokenInfo.symbol,
                decimal: TokenInfo.decimal,
                icon: "",
            },
            fee: 0.003
        })
};

exports.GetPools = async () => {
    // await Pool.create({
    //     poolId: '1111',
    //     name: '2',
    //     token0: {
    //         contractId: "111221",
    //         name: "a",
    //         symbol: "b",
    //         decimal: 6,
    //         icon: "",
    //     },
    //     token1: {
    //         contractId: "111221",
    //         name: "a",
    //         symbol: "b",
    //         decimal: 6,
    //         icon: "",
    //     },
    //     fee: 0.003
    // })
    return await Pool.find()
};

async function GetPool(poolContract, lpPlan, ft_contract_id) {
    const pool = await globalMap.get(poolContract)
    if(!pool) {
        let address_buy = '1EhUy9VYASML4LFCdv5JFQDWBzsjecm3hr';
        let private_buy = 'L1EUcQTQDbDk9QGCcEDyaw2z2tjGwSi9TiGGKnfVwtf7MTkytGdZ';

        let address_sell = '1D6Gy6NAGMhKiVxkYnnERZbDkZo8gYcXa1';
        let private_sell = 'L5Am173ZJqx4iHbqDafZGBLZmfargF6xFN35J1xrR24YFUjyGkXK';

        // switch(poolContract.toLowerCase()) {
        //     case ''.toLowerCase():
        //         address_buy = '';
        //         private_buy = '';
        //         break;
        //     case ''.toLowerCase():
        //         address_sell = '';
        //         private_sell = '';
        //         break;
        // }
        
        const poolUse = new poolEx({
            txid: poolContract,
            network: network,
            address_buy,
            private_buy,
            address_sell,
            private_sell,
            lpPlan,
            ft_contract_id
        })
        await poolUse.initfromContractId()
        await poolUse.boot()
        globalMap.set(poolContract, poolUse)
        return poolUse
    }
    await pool.initfromContractId()
    return pool
}