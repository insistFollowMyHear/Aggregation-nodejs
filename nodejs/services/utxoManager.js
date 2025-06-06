const tbc = require("tbc-lib-js");
const { API ,FT} = require("tbc-contract");
const redis = require('../db/redis');
const { logInfoWithTimestamp, logErrWithTimestamp } = require('../tools/log');
const { sendEmail } = require('../tools/email');

class UTXOManager {
    /**
     * UTXO 分组常量定义
     * SmallChange: 小额找零 UTXO (< 0.01 TBC)
     * TransferFTFee: 转账代币手续费 UTXO (= 0.01 TBC)
     * QueenFee: 大额手续费 UTXO (> 1 TBC)
     * AggregateTradeFee: 聚合交易手续费 UTXO
     */
    static GROUPS = {
        SmallChange: 'smallChange',    // < 0.01 TBC
        TransferFTFee: 'transferFTFee',  // = 0.01 TBC
        QueenFee: 'queenFee',    // > 1 TBC 用于产生TransferFTFee
        AggregateTradeFee: 'aggregateTradeFee'         // 聚合交易手续费 UTXO
    };

    /** 金额精度常量 */
    static PRECISION = 1000000;

    /**
     * 锁定时间常量
     * UTXO 锁定超时时间（秒）
     */
    static LOCK_TIMEOUT = 300;

    /**
     * 构造函数
     * @param {Object} config - 配置对象
     * @param {string|string[]} config.addresses - 地址或地址数组
     * @param {string|string[]} config.privateKeys - 私钥或私钥数组
     * @param {string} config.network - 网络类型
     */
    constructor(config) {
        this.network = config.network;
        this.addresses = Array.isArray(config.addresses) ? config.addresses : [config.address];
        this.privateKeys = Array.isArray(config.privateKeys) ? config.privateKeys : [config.privateKey];
        this.utxoLockTimeout = UTXOManager.LOCK_TIMEOUT; // 使用常量
        this.refreshInterval = 30000; // UTXO 刷新间隔（毫秒）
        this.mergeThreshold = 5; // 第一组 UTXO 合并阈值 100
        this.minTransferFTFeeUtxoCount = 15; // 第二组最小 UTXO 数量 100
        this.minQueenFeeUtxoCount = 1; // 第三组最小 UTXO 数量 
        this.lastRefreshTime = 0; // 上次刷新时间
        this.isInitialized = false; // 初始化标记
    }

    /**
     * 初始化 UTXO 管理器
     * 启动定时刷新任务
     */
    async init() {
        await this.refreshUTXOs(true); // 传入 true 表示是初始化
        setInterval(() => this.refreshUTXOs(false), this.refreshInterval);
    }

    /**
     * 刷新所有地址的 UTXO
     * 按照配置的刷新间隔执行
     * @param {boolean} isInit - 是否是初始化调用
     */
    async refreshUTXOs(isInit = false) {
        const now = Date.now();
        logInfoWithTimestamp(`开始刷新 UTXOs，初始化: ${isInit}`);
        
        if (!isInit && now - this.lastRefreshTime < this.refreshInterval) {
            logInfoWithTimestamp('刷新间隔未到，跳过刷新');
            return;
        }
        
        this.lastRefreshTime = now;
        logInfoWithTimestamp(`刷新时间更新为: ${new Date(this.lastRefreshTime).toISOString()}`);

        for (let i = 0; i < this.addresses.length; i++) {
            const address = this.addresses[i];
            const privateKey = this.privateKeys[i];
            logInfoWithTimestamp(`刷新地址: ${address}`);
            
            await this.refreshAddressUTXOs(address, isInit);
            logInfoWithTimestamp(`地址 ${address} 的 UTXOs 已刷新`);
            
            await this.manageUTXOGroups(address, privateKey);
            logInfoWithTimestamp(`地址 ${address} 的 UTXO 组管理已完成`);

            await this.checkQueenFeeWarning(address);
            logInfoWithTimestamp(`地址 ${address} 的 QueenFee 检查已完成`)
            
        }
    }

    /**
     * 管理 UTXO 分组
     * 处理小额找零 UTXO 合并、生成转账代币手续费 UTXO 和合并聚合交易手续费 UTXO
     * @param {string} address - 地址
     * @param {string} privateKey - 私钥
     */
    async manageUTXOGroups(address, privateKey) {
        try {
            // 处理小额找零 UTXO
            await this.mergeSmallChangeUTXOs(address, privateKey);

            // 生成转账代币手续费 UTXO
            await this.generateTransferFTFeeUTXOs(address, privateKey);

            // 合并聚合交易手续费 UTXO
            await this.mergeFeeUTXOs(address, privateKey);
        } catch (error) {
            logErrWithTimestamp('管理 UTXO 组时发生错误:', error);
        }
    }

    /**
     * 生成转账代币手续费 UTXO
     * 使用 QueenFee UTXO 生成多个 0.01 TBC 的 UTXO
     * @param {string} address - 地址
     * @param {string} privateKey - 私钥
     */
    async generateTransferFTFeeUTXOs(address, privateKey) {
        try {
            logInfoWithTimestamp(`开始为地址 ${address} 生成转账代币手续费 UTXO`);
            
            const queenFeeUtxos = await this.getGroupUTXOs(UTXOManager.GROUPS.QueenFee, address);
            logInfoWithTimestamp(`获取到 QueenFee UTXO 数量: ${queenFeeUtxos.length}`);
            
            if (queenFeeUtxos.length === 0) {
                logInfoWithTimestamp('没有可用的 QueenFee UTXO，退出生成过程');
                return;
            }

            // 计算需要生成的 UTXO 数量
            const currentTransferFTFeeUtxos = await this.getGroupUTXOs(UTXOManager.GROUPS.TransferFTFee, address);
            const neededUtxos = this.minTransferFTFeeUtxoCount - currentTransferFTFeeUtxos.length;
            logInfoWithTimestamp(`当前转账代币手续费 UTXO 数量: ${currentTransferFTFeeUtxos.length}, 需要生成: ${neededUtxos}`);
            
            if (neededUtxos <= 0) {
                logInfoWithTimestamp('当前转账代币手续费 UTXO 数量已满足要求，无需生成');
                return;
            }

            // 计算每个 UTXO 的金额（0.01 TBC）
            const utxoAmount = 0.01 * UTXOManager.PRECISION;
            // 计算总金额（包括手续费）
            const totalAmount = (utxoAmount * neededUtxos) + (0.001 * UTXOManager.PRECISION);
            logInfoWithTimestamp(`每个 UTXO 金额: ${utxoAmount / UTXOManager.PRECISION} TBC, 总金额(含手续费): ${totalAmount / UTXOManager.PRECISION} TBC`);

            // 从 QueenFee UTXO 中选择足够的输入
            let selectedUtxos = [];
            let totalSelectedAmount = 0;
            
            // 按金额从大到小排序
            const sortedQueenFeeUtxos = queenFeeUtxos.sort((a, b) => b.satoshis - a.satoshis);
            
            for (const utxo of sortedQueenFeeUtxos) {
                if (totalSelectedAmount >= totalAmount) {
                    break;
                }
                
                // 检查 UTXO 是否被锁定
                if (await this.isUTXOLocked(utxo, address)) {
                    logInfoWithTimestamp(`UTXO ${utxo.txId}:${utxo.outputIndex} 已被锁定，跳过`);
                    continue;
                }
                
                // 尝试锁定 UTXO
                if (await this.lockUTXO(utxo, address)) {
                    selectedUtxos.push(utxo);
                    totalSelectedAmount += utxo.satoshis;
                    logInfoWithTimestamp(`已选择 UTXO ${utxo.txId}:${utxo.outputIndex}, 金额: ${utxo.satoshis / UTXOManager.PRECISION} TBC`);
                }
            }

            if (totalSelectedAmount < totalAmount) {
                // 解锁已选择的 UTXO
                await this.unlockUTXOs(selectedUtxos, address);
                logInfoWithTimestamp(`可用 UTXO 金额不足，需要: ${totalAmount / UTXOManager.PRECISION} TBC, 实际: ${totalSelectedAmount / UTXOManager.PRECISION} TBC`);
                return;
            }

            logInfoWithTimestamp(`已选择 ${selectedUtxos.length} 个 UTXO，总金额: ${totalSelectedAmount / UTXOManager.PRECISION} TBC`);

            // 构建交易
            const tx = new tbc.Transaction()
                .from(selectedUtxos);

            // 添加多个输出
            for (let i = 0; i < neededUtxos; i++) {
                tx.to(address, utxoAmount);
            }
            logInfoWithTimestamp(`已添加 ${neededUtxos} 个输出到交易中`);

            // 添加找零
            tx.change(address);
            logInfoWithTimestamp('已添加找零输出');

            // 计算手续费
            const txSize = tx.getEstimateSize();
            if (txSize < 1000) {
                tx.fee(80);
                logInfoWithTimestamp(`交易大小小于 1000 字节，设置固定手续费: 80 satoshis`);
            } else {
                tx.feePerKb(100);
                logInfoWithTimestamp(`交易大小: ${txSize} 字节，设置每 KB 手续费: 100 satoshis`);
            }

            // 签名并广播交易
            tx.sign(privateKey);
            tx.seal();
            const txraw = tx.uncheckedSerialize();
            logInfoWithTimestamp('交易已签名，准备广播');
            
            const txid = await API.broadcastTXraw(txraw, this.network);
            logInfoWithTimestamp(`交易已广播到网络，交易ID: ${txid}`);
            
            // 等待交易确认
            await new Promise(resolve => setTimeout(resolve, 5000));
            logInfoWithTimestamp('等待 5 秒确认交易广播');

            // 更新 Redis 中的 UTXO 状态
            const multi = redis.multi();

            // 1. 从 QueenFee 分组中删除已使用的 UTXO
            const queenFeeKey = `utxo:${address}:group:${UTXOManager.GROUPS.QueenFee}`;
            for (const utxo of selectedUtxos) {
                const utxoStr = JSON.stringify(utxo);
                multi.srem(queenFeeKey, utxoStr);
            }
            logInfoWithTimestamp(`已从 QueenFee 分组中删除 ${selectedUtxos.length} 个已使用的 UTXO`);

            // 2. 添加新生成的 TransferFTFee UTXO 到 Redis
            const TransferFTFeeKey = `utxo:${address}:group:${UTXOManager.GROUPS.TransferFTFee}`;
            for (let i = 0; i < neededUtxos; i++) {
                const newUtxo = {
                    txId: txid,
                    outputIndex: i,
                    satoshis: utxoAmount,
                    script: tx.outputs[i].script.toHex()
                };
                multi.sadd(TransferFTFeeKey, JSON.stringify(newUtxo));
            }
            logInfoWithTimestamp(`已添加 ${neededUtxos} 个新的 TransferFTFee UTXO 到 Redis`);

            // 3. 如果有找零，添加到 QueenFee 分组
            if (tx.outputs[neededUtxos]) {
                const changeUtxo = {
                    txId: txid,
                    outputIndex: neededUtxos,
                    satoshis: tx.outputs[neededUtxos].satoshis,
                    script: tx.outputs[neededUtxos].script.toHex()
                };
                multi.sadd(queenFeeKey, JSON.stringify(changeUtxo));
                logInfoWithTimestamp(`已添加找零 UTXO 到 QueenFee 分组，金额: ${changeUtxo.satoshis / UTXOManager.PRECISION} TBC`);
            }

            // 执行所有 Redis 操作
            await multi.exec();
            logInfoWithTimestamp('Redis UTXO 状态更新完成');

            // 解锁已使用的 UTXO
            await this.unlockUTXOs(selectedUtxos, address);
            logInfoWithTimestamp('已解锁使用的 UTXO');
        } catch (error) {
            logErrWithTimestamp('生成转账代币手续费 UTXO 时发生错误:', error);
        }
    }

    /**
     * 合并小额找零 UTXO
     * @param {string} address - 地址
     * @param {string} privateKey - 私钥
     */
    async mergeSmallChangeUTXOs(address, privateKey) {
        try {
            // 获取小额找零UTXO
            const smallChangeUtxos = await this.getGroupUTXOs(UTXOManager.GROUPS.SmallChange, address);
            
            // 检查小额UTXO数量是否达到合并阈值
            if (smallChangeUtxos.length < this.mergeThreshold) {
                logInfoWithTimestamp(`小额找零 UTXO 数量 ${smallChangeUtxos.length} 未达到合并阈值 ${this.mergeThreshold}，跳过合并`);
                return;
            }

            logInfoWithTimestamp(`开始合并地址 ${address} 的小额找零 UTXO，数量: ${smallChangeUtxos.length}`);
            
            // 计算总金额
            const totalAmount = smallChangeUtxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);
            logInfoWithTimestamp(`小额找零 UTXO 总金额: ${totalAmount / UTXOManager.PRECISION} TBC`);

            // 计算合并后的主输出金额（减去手续费）
            const mainOutputAmount = totalAmount - (0.001 * UTXOManager.PRECISION);
            
            // 如果合并后金额小于0.01 TBC，且UTXO数量小于1000，则跳过合并
            if (mainOutputAmount < 0.01 * UTXOManager.PRECISION && smallChangeUtxos.length < 1000) {
                logInfoWithTimestamp(`合并后金额 ${mainOutputAmount / UTXOManager.PRECISION} TBC 仍小于 0.01 TBC，且UTXO数量 ${smallChangeUtxos.length} 小于1000，等待下次合并`);
                return;
            }

            // 构建交易
            const tx = new tbc.Transaction()
                .from(smallChangeUtxos)
                .to(address, mainOutputAmount)
                .change(address);

            // 计算手续费
            const txSize = tx.getEstimateSize();
            if (txSize < 1000) {
                tx.fee(80);
                logInfoWithTimestamp(`交易大小小于 1000 字节，设置固定手续费: 80 satoshis`);
            } else {
                tx.feePerKb(100);
                logInfoWithTimestamp(`交易大小: ${txSize} 字节，设置每 KB 手续费: 100 satoshis`);
            }

            // 签名并广播交易
            tx.sign(privateKey);
            tx.seal();
            const txraw = tx.uncheckedSerialize();
            logInfoWithTimestamp('交易已签名，准备广播');
            
            const txid = await API.broadcastTXraw(txraw, this.network);
            logInfoWithTimestamp(`交易已广播到网络，交易ID: ${txid}`);
            
            // 等待交易确认
            await new Promise(resolve => setTimeout(resolve, 5000));
            logInfoWithTimestamp('等待 5 秒确认交易广播');

            // 从 Redis 中删除已合并的小额找零 UTXO
            const smallChangeKey = `utxo:${address}:group:${UTXOManager.GROUPS.SmallChange}`;
            const multi = redis.multi();
            
            for (const utxo of smallChangeUtxos) {
                const utxoStr = JSON.stringify(utxo);
                multi.srem(smallChangeKey, utxoStr);
                logInfoWithTimestamp(`从 SmallChange 分组中删除 UTXO: ${utxo.txId}:${utxo.outputIndex}`);
            }
            
            // 根据金额大小决定将新生成的 UTXO 添加到哪个分组
            const mainUtxo = {
                txId: txid,
                outputIndex: 0,
                satoshis: mainOutputAmount,
                script: tx.outputs[0].script.toHex()
            };

            // 使用静态方法确定分组
            const targetGroup = UTXOManager.getUTXOGroupByAmount(mainOutputAmount);
            const targetKey = `utxo:${address}:group:${targetGroup}`;
            multi.sadd(targetKey, JSON.stringify(mainUtxo));
            logInfoWithTimestamp(`已添加新生成的 UTXO 到 ${targetGroup} 分组，金额: ${mainOutputAmount / UTXOManager.PRECISION} TBC`);

            // 如果有找零，也根据金额大小决定分组
            if (tx.outputs[1]) {
                const changeAmount = tx.outputs[1].satoshis;
                const changeUtxo = {
                    txId: txid,
                    outputIndex: 1,
                    satoshis: changeAmount,
                    script: tx.outputs[1].script.toHex()
                };

                // 使用静态方法确定找零分组
                const changeGroup = UTXOManager.getUTXOGroupByAmount(changeAmount);
                const changeKey = `utxo:${address}:group:${changeGroup}`;
                multi.sadd(changeKey, JSON.stringify(changeUtxo));
                logInfoWithTimestamp(`已添加找零 UTXO 到 ${changeGroup} 分组，金额: ${changeAmount / UTXOManager.PRECISION} TBC`);
            }

            // 执行所有 Redis 操作
            await multi.exec();
            logInfoWithTimestamp('Redis UTXO 状态更新完成');

            // 解锁已使用的 UTXO
            await this.unlockUTXOs(smallChangeUtxos, address);
            logInfoWithTimestamp('已解锁使用的 UTXO');
        } catch (error) {
            logErrWithTimestamp('合并小额找零 UTXO 时发生错误:', error);
            // 发生错误时也要解锁 UTXO
            await this.unlockUTXOs(smallChangeUtxos, address);
            throw error;
        }
    }

    /**
     * 合并聚合交易手续费 UTXO
     * 将多个聚合交易手续费 UTXO 合并成 QueenFee
     * 如果合并后金额小于 1 TBC，发送邮件通知
     * @param {string} address - 地址
     * @param {string} privateKey - 私钥
     */
    async mergeFeeUTXOs(address, privateKey) {
        try {
            // 获取聚合交易手续费UTXO
            const aggregateTradeFeeUtxos = await this.getGroupUTXOs(UTXOManager.GROUPS.AggregateTradeFee, address);
            
            // 获取QueenFee UTXO
            const queenFeeUtxos = await this.getGroupUTXOs(UTXOManager.GROUPS.QueenFee, address);
            
            // 如果QueenFee UTXO数量超过100，则与聚合交易手续费UTXO一起合并
            let utxosToMerge = aggregateTradeFeeUtxos;
            if (queenFeeUtxos.length > 100) {
                utxosToMerge = [...aggregateTradeFeeUtxos, ...queenFeeUtxos];
                logInfoWithTimestamp(`QueenFee UTXO 数量 ${queenFeeUtxos.length} 超过100，将与聚合交易手续费UTXO一起合并`);
            }
            
            // 如果UTXO数量不足，则跳过
            if (utxosToMerge.length < this.mergeThreshold) {
                logInfoWithTimestamp(`UTXO 数量 ${utxosToMerge.length} 未达到合并阈值 ${this.mergeThreshold}，跳过合并`);
                return;
            }

            logInfoWithTimestamp(`开始合并地址 ${address} 的 UTXO，数量: ${utxosToMerge.length}`);
            
            // 计算总金额
            const totalAmount = utxosToMerge.reduce((sum, utxo) => sum + utxo.satoshis, 0);
            logInfoWithTimestamp(`UTXO 总金额: ${totalAmount / UTXOManager.PRECISION} TBC`);

            // 计算合并后的主输出金额（减去手续费）
            const mainOutputAmount = totalAmount - (0.001 * UTXOManager.PRECISION);
            
            // 如果合并后金额小于1 TBC，则跳过合并
            if (mainOutputAmount < 1 * UTXOManager.PRECISION && utxosToMerge.length <= 100) {
                logInfoWithTimestamp(`合并后金额 ${mainOutputAmount / UTXOManager.PRECISION} TBC 小于 1 TBC，且 UTXO 数量 ${utxosToMerge.length} 不超过 100，等待下次合并`);
                return;
            }

            // 构建交易
            const tx = new tbc.Transaction()
                .from(utxosToMerge)
                .to(address, mainOutputAmount)
                .change(address);

            // 计算手续费
            const txSize = tx.getEstimateSize();
            if (txSize < 1000) {
                tx.fee(80);
                logInfoWithTimestamp(`交易大小小于 1000 字节，设置固定手续费: 80 satoshis`);
            } else {
                tx.feePerKb(100);
                logInfoWithTimestamp(`交易大小: ${txSize} 字节，设置每 KB 手续费: 100 satoshis`);
            }

            // 签名并广播交易
            tx.sign(privateKey);
            tx.seal();
            const txraw = tx.uncheckedSerialize();
            logInfoWithTimestamp('交易已签名，准备广播');
            
            const txid = await API.broadcastTXraw(txraw, this.network);
            logInfoWithTimestamp(`交易已广播到网络，交易ID: ${txid}`);
            
            // 等待交易确认
            await new Promise(resolve => setTimeout(resolve, 5000));
            logInfoWithTimestamp('等待 5 秒确认交易广播');

            // 从 Redis 中删除已合并的 UTXO
            const multi = redis.multi();
            
            // 删除聚合交易手续费 UTXO
            const aggregateTradeFeeKey = `utxo:${address}:group:${UTXOManager.GROUPS.AggregateTradeFee}`;
            for (const utxo of aggregateTradeFeeUtxos) {
                const utxoStr = JSON.stringify(utxo);
                multi.srem(aggregateTradeFeeKey, utxoStr);
                logInfoWithTimestamp(`从 AggregateTradeFee 分组中删除 UTXO: ${utxo.txId}:${utxo.outputIndex}`);
            }
            
            // 如果合并了 QueenFee UTXO，则也删除它们
            if (queenFeeUtxos.length > 100) {
                const queenFeeKey = `utxo:${address}:group:${UTXOManager.GROUPS.QueenFee}`;
                for (const utxo of queenFeeUtxos) {
                    const utxoStr = JSON.stringify(utxo);
                    multi.srem(queenFeeKey, utxoStr);
                    logInfoWithTimestamp(`从 QueenFee 分组中删除 UTXO: ${utxo.txId}:${utxo.outputIndex}`);
                }
            }
            
            // 将新生成的 UTXO 添加到 QueenFee 分组
            const queenFeeKey = `utxo:${address}:group:${UTXOManager.GROUPS.QueenFee}`;
            const mainUtxo = {
                txId: txid,
                outputIndex: 0,
                satoshis: mainOutputAmount,
                script: tx.outputs[0].script.toHex()
            };
            multi.sadd(queenFeeKey, JSON.stringify(mainUtxo));
            logInfoWithTimestamp(`已添加新生成的 UTXO 到 QueenFee 分组，金额: ${mainOutputAmount / UTXOManager.PRECISION} TBC`);

            // 如果有找零，也根据金额大小决定分组
            if (tx.outputs[1]) {
                const changeAmount = tx.outputs[1].satoshis;
                const changeUtxo = {
                    txId: txid,
                    outputIndex: 1,
                    satoshis: changeAmount,
                    script: tx.outputs[1].script.toHex()
                };

                // 使用静态方法确定找零分组
                const changeGroup = UTXOManager.getUTXOGroupByAmount(changeAmount);
                const changeKey = `utxo:${address}:group:${changeGroup}`;
                multi.sadd(changeKey, JSON.stringify(changeUtxo));
                logInfoWithTimestamp(`已添加找零 UTXO 到 ${changeGroup} 分组，金额: ${changeAmount / UTXOManager.PRECISION} TBC`);
            }

            // 执行所有 Redis 操作
            await multi.exec();
            logInfoWithTimestamp('Redis UTXO 状态更新完成');

            // 解锁已使用的 UTXO
            await this.unlockUTXOs(utxosToMerge, address);
            logInfoWithTimestamp('已解锁使用的 UTXO');
        } catch (error) {
            logErrWithTimestamp('合并手续费 UTXO 时发生错误:', error);
            // 发生错误时也要解锁 UTXO
            await this.unlockUTXOs(aggregateTradeFeeUtxos, address);
            if (queenFeeUtxos.length > 100) {
                await this.unlockUTXOs(queenFeeUtxos, address);
            }
            throw error;
        }
    }

    /**
     * 标记聚合交易手续费 UTXO
     * @param {string} txId - 交易ID
     * @param {string} address - 地址
     * @returns {Promise<boolean>} 标记是否成功
     */
    async markAggregateTradeFeeUTXO(txId, address) {
        try {
            logInfoWithTimestamp(`开始标记聚合交易手续费 UTXO: ${txId} 地址: ${address}`);
            
            // 获取该交易的所有 UTXO
            const utxos = await API.fetchUTXOs(address, this.network);
            const feeUtxo = utxos.find(utxo => utxo.txId === txId);
            
            if (!feeUtxo) {
                logInfoWithTimestamp(`未找到交易 ${txId} 的 UTXO`);
                return false;
            }

            // 将 UTXO 添加到 AggregateTradeFee 分组
            const key = `utxo:${address}:group:${UTXOManager.GROUPS.AggregateTradeFee}`;
            await redis.sadd(key, JSON.stringify(feeUtxo));
            
            logInfoWithTimestamp(`成功标记聚合交易手续费 UTXO: ${txId}:${feeUtxo.outputIndex}, 金额: ${feeUtxo.satoshis / UTXOManager.PRECISION} TBC`);
            return true;
        } catch (error) {
            logErrWithTimestamp('标记聚合交易手续费 UTXO 时发生错误:', error);
            return false;
        }
    }

    /**
     * 锁定单个 UTXO
     * @param {Object} utxo - UTXO 对象
     * @param {string} address - 地址
     * @returns {Promise<boolean>} 锁定是否成功
     */
    async lockUTXO(utxo, address) {
        const key = `utxo:${address}:lock:${utxo.txId}:${utxo.outputIndex}`;
        const result = await redis.set(key, 'locked', 'NX', 'EX', UTXOManager.LOCK_TIMEOUT); // 使用常量
        return result === 'OK';
    }

    /**
     * 解锁单个 UTXO
     * @param {Object} utxo - UTXO 对象
     * @param {string} address - 地址
     */
    async unlockUTXO(utxo, address) {
        const key = `utxo:${address}:lock:${utxo.txId}:${utxo.outputIndex}`;
        await redis.del(key);
    }

    /**
     * 检查 UTXO 是否被锁定
     * @param {Object} utxo - UTXO 对象
     * @param {string} address - 地址
     * @returns {Promise<boolean>} 是否被锁定
     */
    async isUTXOLocked(utxo, address) {
        const key = `utxo:${address}:lock:${utxo.txId}:${utxo.outputIndex}`;
        return await redis.get(key) === 'locked';
    }

    /**
     * 批量锁定 UTXO
     * @param {Array} utxos - UTXO 数组
     * @param {string} address - 地址
     * @returns {Promise<Array>} 成功锁定的 UTXO 数组
     */
    async lockUTXOs(utxos, address) {
        const multi = redis.multi();
        const lockedUtxos = [];
        
        for (const utxo of utxos) {
            const key = `utxo:${address}:lock:${utxo.txId}:${utxo.outputIndex}`;
            multi.set(key, 'locked', 'NX', 'EX', UTXOManager.LOCK_TIMEOUT); // 使用常量
        }
        
        const results = await multi.exec();
        
        for (let i = 0; i < results.length; i++) {
            if (results[i][1] === 'OK') {
                lockedUtxos.push(utxos[i]);
            }
        }
        
        return lockedUtxos;
    }

    /**
     * 批量解锁 UTXO
     * @param {Array} utxos - UTXO 数组
     * @param {string} address - 地址
     */
    async unlockUTXOs(utxos, address) {
        const multi = redis.multi();
        
        for (const utxo of utxos) {
            const key = `utxo:${address}:lock:${utxo.txId}:${utxo.outputIndex}`;
            multi.del(key);
        }
        
        await multi.exec();
    }

    /**
     * 检查多个 UTXO 是否都被锁定
     * @param {Array} utxos - UTXO 数组
     * @param {string} address - 地址
     * @returns {Promise<boolean>} 是否全部被锁定
     */
    async areUTXOsLocked(utxos, address) {
        const multi = redis.multi();
        
        for (const utxo of utxos) {
            const key = `utxo:${address}:lock:${utxo.txId}:${utxo.outputIndex}`;
            multi.get(key);
        }
        
        const results = await multi.exec();
        return results.every(result => result[1] === 'locked');
    }

    /**
     * 将 UTXO 按金额分组
     * @param {Array} utxos - UTXO 数组
     * @returns {Object} 分组后的 UTXO 对象
     */
    groupUTXOs(utxos) {
        const groups = {
            [UTXOManager.GROUPS.SmallChange]: [],
            [UTXOManager.GROUPS.TransferFTFee]: [],
            [UTXOManager.GROUPS.QueenFee]: [],
            [UTXOManager.GROUPS.AggregateTradeFee]: []
        };

        for (const utxo of utxos) {
            const amount = utxo.satoshis / UTXOManager.PRECISION;
            if (amount < 0.01) {
                groups[UTXOManager.GROUPS.SmallChange].push(utxo);
            } else if (amount === 0.01) {
                groups[UTXOManager.GROUPS.TransferFTFee].push(utxo);
            } else if (amount > 1) {
                groups[UTXOManager.GROUPS.QueenFee].push(utxo);
            } else if (amount >= 0.01 && amount < 1) {
                groups[UTXOManager.GROUPS.AggregateTradeFee].push(utxo);
            }
        }

        return groups;
    }

    /**
     * 更新 Redis 缓存中的 UTXO 分组
     * @param {Object} groupedUtxos - 分组后的 UTXO
     * @param {string} address - 地址
     * @param {boolean} isInit - 是否是初始化调用
     */
    async updateRedisCache(groupedUtxos, address, isInit = false) {
        const multi = redis.multi();
        
        // 清除旧的缓存（除了 QueenFee 分组）
        multi.del(`utxo:${address}:group:${UTXOManager.GROUPS.SmallChange}`);
        multi.del(`utxo:${address}:group:${UTXOManager.GROUPS.TransferFTFee}`);
        // 不清除 AggregateTradeFee 分组的缓存，因为它由 markFeeUTXO 方法管理
        
        // 只在初始化时更新 QueenFee 分组
        if (isInit) {
            multi.del(`utxo:${address}:group:${UTXOManager.GROUPS.QueenFee}`);
            const largeUtxos = groupedUtxos[UTXOManager.GROUPS.QueenFee];
            if (largeUtxos.length > 0) {
                for (const utxo of largeUtxos) {
                    multi.sadd(`utxo:${address}:group:${UTXOManager.GROUPS.QueenFee}`, JSON.stringify(utxo));
                }
            }
        }
        
        // 更新其他分组
        for (const [group, utxos] of Object.entries(groupedUtxos)) {
            if (group !== UTXOManager.GROUPS.QueenFee && group !== UTXOManager.GROUPS.AggregateTradeFee) {
                for (const utxo of utxos) {
                    multi.sadd(`utxo:${address}:group:${group}`, JSON.stringify(utxo));
                }
            }
        }
        
        await multi.exec();
    }

    /**
     * 获取指定分组的 UTXO
     * @param {string} group - 分组名称
     * @param {string} address - 地址
     * @returns {Promise<Array>} UTXO 数组
     */
    async getGroupUTXOs(group, address) {
        const key = `utxo:${address}:group:${group}`;
        const utxos = await redis.smembers(key);
        return utxos.map(u => JSON.parse(u));
    }

    /**
     * 获取地址的所有 UTXO 并按金额分组
     * @param {string} address - 地址
     * @returns {Promise<Object>} 分组后的 UTXO 对象
     */
    async getGroupedUTXOs(address) {
        let utxos;
        let attempts = 0;
        const maxRetries = 3;
        while (attempts < maxRetries) {
            try {
                utxos = await API.fetchUTXOs(address, this.network);
                break; // 成功获取到 UTXOs，跳出循环
            } catch (error) {
                attempts++;
                logErrWithTimestamp(`获取 UTXOs 时发生错误，重试次数: ${attempts}`, error);
                if (attempts >= maxRetries) {
                    throw new Error('获取 UTXOs 失败，已达到最大重试次数');
                }
            }
        }
        return this.groupUTXOs(utxos);
    }

    /**
     * 刷新指定地址的 UTXO
     * @param {string} address - 地址
     * @param {boolean} isInit - 是否是初始化调用
     */
    async refreshAddressUTXOs(address, isInit = false) {
        const groupedUtxos = await this.getGroupedUTXOs(address);
        await this.updateRedisCache(groupedUtxos, address, isInit);
    }

    /**
     * 根据金额获取UTXO分组
     * @param {*} amount 
     * @returns 
     */
    static getUTXOGroupByAmount(amount) {
        const amountInTBC = amount / UTXOManager.PRECISION;
        if (amountInTBC < 0.01) {
            return UTXOManager.GROUPS.SmallChange;
        } else if (amountInTBC >= 0.01 && amountInTBC < 1) {
            return UTXOManager.GROUPS.AggregateTradeFee;
        } else {
            return UTXOManager.GROUPS.QueenFee;
        }
    }

    /**
     * 检查QueenFee UTXO的预警
     * @param {string} address - 地址
     */
    async checkQueenFeeWarning(address) {
        try {
            // 获取QueenFee UTXO
            const queenFeeUtxos = await this.getGroupUTXOs(UTXOManager.GROUPS.QueenFee, address);
            
            if (queenFeeUtxos.length === 0) {
                // 发送邮件通知
                const emailSubject = '警告：QueenFee UTXO 为空';
                const emailContent = `
                    地址: ${address}
                    当前 QueenFee UTXO 数量: 0
                    请及时处理！
                `;
                await sendEmail(emailSubject, emailContent);
                logInfoWithTimestamp(`已发送 QueenFee UTXO 为空警告邮件`);
                return;
            }

            // 找出最大的QueenFee UTXO
            const maxQueenFeeUtxo = queenFeeUtxos.reduce((max, utxo) => 
                utxo.satoshis > max.satoshis ? utxo : max
            );

            // 如果最大UTXO金额小于1 TBC，发送邮件通知
            if (maxQueenFeeUtxo.satoshis < 1 * UTXOManager.PRECISION) {
                const emailSubject = '警告：QueenFee UTXO 金额不足';
                const emailContent = `
                    地址: ${address}
                    当前最大 QueenFee UTXO 金额: ${maxQueenFeeUtxo.satoshis / UTXOManager.PRECISION} TBC
                    UTXO ID: ${maxQueenFeeUtxo.txId}:${maxQueenFeeUtxo.outputIndex}
                    请及时处理！
                `;
                await sendEmail(emailSubject, emailContent);
                logInfoWithTimestamp(`已发送 QueenFee UTXO 金额不足警告邮件`);
            }
        } catch (error) {
            logErrWithTimestamp('检查 QueenFee UTXO 预警时发生错误:', error);
        }
    }

    /**
     * 获取指定数量的 TransferFTFee UTXO
     * @param {string} address - 地址
     * @param {number} count - 需要获取的 UTXO 数量
     * @returns {Promise<Array|null>} 成功返回 UTXO 数组，失败返回 null
     */
    async getTransferFTFeeUTXOs(address, count) {
        try {
            logInfoWithTimestamp(`开始获取地址 ${address} 的 ${count} 个 TransferFTFee UTXO`);
            
            // 获取 TransferFTFee 分组的 UTXO
            const utxos = await this.getGroupUTXOs(UTXOManager.GROUPS.TransferFTFee, address);
            logInfoWithTimestamp(`获取到 ${utxos.length} 个 TransferFTFee UTXO`);
            
            const availableUtxos = [];

            // 遍历 UTXO，尝试锁定未锁定的 UTXO
            for (const utxo of utxos) {
                if (availableUtxos.length >= count) break;

                if (!(await this.isUTXOLocked(utxo, address))) {
                    if (await this.lockUTXO(utxo, address)) {
                        availableUtxos.push({ utxo, address });
                        logInfoWithTimestamp(`成功锁定 UTXO: ${utxo.txId}:${utxo.outputIndex}`);
                    }
                }
            }

            // 如果获取到的 UTXO 数量不足，解锁已锁定的 UTXO 并返回 null
            if (availableUtxos.length < count) {
                logInfoWithTimestamp(`可用 TransferFTFee UTXO 数量不足，需要: ${count}，实际: ${availableUtxos.length}`);
                await this.unlockUTXOs(availableUtxos.map(item => item.utxo), address);
                return null;
            }

            logInfoWithTimestamp(`成功获取 ${availableUtxos.length} 个 TransferFTFee UTXO`);
            return availableUtxos;
        } catch (error) {
            logErrWithTimestamp('获取 TransferFTFee UTXO 时发生错误:', error);
            // 发生错误时解锁已锁定的 UTXO
            if (availableUtxos && availableUtxos.length > 0) {
                await this.unlockUTXOs(availableUtxos.map(item => item.utxo), address);
            }
            return null;
        }
    }

    /**
     * 通过交易哈希获取指定的 UTXO
     * @param {string} address - 地址
     * @param {Array<string>} hashes - 交易哈希数组
     * @param {number} [maxRetries=3] - 最大重试次数
     * @param {number} [retryInterval=2000] - 重试间隔（毫秒）
     * @returns {Promise<Array|null>} 成功返回 UTXO 数组，失败返回 null
     */
    async getUTXOsByHashes(address, hashes, maxRetries = 3, retryInterval = 2000) {
        let retryCount = 0;
        let availableUtxos = [];

        while (retryCount <= maxRetries) {
            try {
                if (retryCount > 0) {
                    logInfoWithTimestamp(`第 ${retryCount} 次重试获取 UTXO...`);
                    // 等待指定的重试间隔
                    await new Promise(resolve => setTimeout(resolve, retryInterval));
                }

                logInfoWithTimestamp(`开始获取地址 ${address} 的指定交易哈希的 UTXO: ${hashes.join(', ')}`);
                
                // 从区块链获取最新的 UTXO 数据
                const allUtxos = await API.fetchUTXOs(address, this.network);
                logInfoWithTimestamp(`从区块链获取到 ${allUtxos.length} 个 UTXO`);
                
                // 将哈希数组转换为 Set 以提高查找效率
                const hashSet = new Set(hashes);
                
                // 筛选出指定哈希的 UTXO
                const targetUtxos = allUtxos.filter(utxo => hashSet.has(utxo.txId));
                logInfoWithTimestamp(`找到 ${targetUtxos.length} 个匹配的 UTXO`);
                
                // 如果没有找到任何匹配的 UTXO，进行重试
                if (targetUtxos.length === 0) {
                    logInfoWithTimestamp('未找到任何匹配的 UTXO');
                    retryCount++;
                    continue;
                }

                // 尝试锁定找到的 UTXO
                availableUtxos = [];
                for (const utxo of targetUtxos) {
                    if (!(await this.isUTXOLocked(utxo, address))) {
                        if (await this.lockUTXO(utxo, address)) {
                            availableUtxos.push({ utxo, address });
                            logInfoWithTimestamp(`成功锁定 UTXO: ${utxo.txId}:${utxo.outputIndex}`);
                        }
                    }
                }

                // 如果无法锁定任何 UTXO，进行重试
                if (availableUtxos.length === 0) {
                    logInfoWithTimestamp('无法锁定任何匹配的 UTXO');
                    retryCount++;
                    continue;
                }

                logInfoWithTimestamp(`成功获取并锁定 ${availableUtxos.length} 个指定交易哈希的 UTXO`);
                return availableUtxos;

            } catch (error) {
                logErrWithTimestamp(`获取指定交易哈希的 UTXO 时发生错误 (第 ${retryCount + 1} 次尝试):`, error);
                
                // 解锁已锁定的 UTXO
                if (availableUtxos && availableUtxos.length > 0) {
                    await this.unlockUTXOs(availableUtxos.map(item => item.utxo), address);
                    availableUtxos = [];
                }

                retryCount++;
                
                // 如果达到最大重试次数，返回 null
                if (retryCount > maxRetries) {
                    logErrWithTimestamp(`已达到最大重试次数 ${maxRetries}，放弃获取 UTXO`);
                    return null;
                }
            }
        }

        return null;
    }

    /**
     * 通过交易哈希获取指定的 FT UTXO
     * @param {string} address - 地址
     * @param {string} ftContractTxid - FT 合约交易 ID
     * @param {Array<string>} hashes - 交易哈希数组
     * @returns {Promise<Array|null>} 成功返回 FT UTXO 数组，失败返回 null
     */
    async getFTUTXOsByHashes(address, ftContractTxid, hashes ) {
        let retryCount = 0;
        let maxRetries = 3;
        let retryInterval = 2000;
        let availableFtUtxos = [];

        while (retryCount <= maxRetries) {
            try {
                if (retryCount > 0) {
                    logInfoWithTimestamp(`第 ${retryCount} 次重试获取 FT UTXO...`);
                    // 等待指定的重试间隔
                    await new Promise(resolve => setTimeout(resolve, retryInterval));
                }

                logInfoWithTimestamp(`开始获取地址 ${address} 的指定交易哈希的 FT UTXO: ${hashes.join(', ')}`);
                
                // 初始化 FT Token
                const Token = new FT(ftContractTxid);
                const TokenInfo = await API.fetchFtInfo(Token.contractTxid, this.network);
                await Token.initialize(TokenInfo);
                
                // 构建 FT 转账代码脚本
                const ftutxo_codeScript = FT.buildFTtransferCode(Token.codeScript, address).toBuffer().toString('hex');
                
                // 获取所有 FT UTXO
                const ftutxolist = await API.fetchFtUTXOList(ftContractTxid, address, ftutxo_codeScript, this.network);
                logInfoWithTimestamp(`获取到 ${ftutxolist.length} 个 FT UTXO`);
                
                // 将哈希数组转换为 Set 以提高查找效率
                const hashSet = new Set(hashes);
                
                // 筛选出指定哈希的 FT UTXO
                const targetFtUtxos = ftutxolist.filter(utxo => hashSet.has(utxo.txId));
                logInfoWithTimestamp(`找到 ${targetFtUtxos.length} 个匹配的 FT UTXO`);
                
                // 如果没有找到任何匹配的 FT UTXO，进行重试
                if (targetFtUtxos.length === 0) {
                    logInfoWithTimestamp('未找到任何匹配的 FT UTXO');
                    retryCount++;
                    continue;
                }

                // 尝试锁定找到的 FT UTXO
                availableFtUtxos = [];
                for (const utxo of targetFtUtxos) {
                    if (!(await this.isUTXOLocked(utxo, address))) {
                        if (await this.lockUTXO(utxo, address)) {
                            availableFtUtxos.push({ utxo, address });
                            logInfoWithTimestamp(`成功锁定 FT UTXO: ${utxo.txId}:${utxo.outputIndex}, FT余额: ${utxo.ftBalance}`);
                        }
                    }
                }

                // 如果无法锁定任何 FT UTXO，进行重试
                if (availableFtUtxos.length === 0) {
                    logInfoWithTimestamp('无法锁定任何匹配的 FT UTXO');
                    retryCount++;
                    continue;
                }

                logInfoWithTimestamp(`成功获取并锁定 ${availableFtUtxos.length} 个指定交易哈希的 FT UTXO`);
                return availableFtUtxos;

            } catch (error) {
                logErrWithTimestamp(`获取指定交易哈希的 FT UTXO 时发生错误 (第 ${retryCount + 1} 次尝试):`, error);
                
                // 解锁已锁定的 UTXO
                if (availableFtUtxos && availableFtUtxos.length > 0) {
                    await this.unlockUTXOs(availableFtUtxos.map(item => item.utxo), address);
                    availableFtUtxos = [];
                }

                retryCount++;
                
                // 如果达到最大重试次数，返回 null
                if (retryCount > maxRetries) {
                    logErrWithTimestamp(`已达到最大重试次数 ${maxRetries}，放弃获取 FT UTXO`);
                    return null;
                }
            }
        }

        return null;
    }
}

module.exports = UTXOManager; 