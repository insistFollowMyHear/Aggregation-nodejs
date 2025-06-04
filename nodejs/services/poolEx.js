const tbc = require("tbc-lib-js");
const { API, FT, poolNFT2 } = require("tbc-contract");
const {PrivateKey} = require("tbc-lib-js");
const {BuyTrade} = require('../model/BuyTrade');
const {SellTrade} = require('../model/SellTrade');
const {FTPrice} = require('../model/FTPrice');
const { logInfoWithTimestamp, logErrWithTimestamp, logWarnWithTimestamp } = require('../tools/log');


class poolEx extends poolNFT2 {

    constructor(config = {}) {
        super({ txid: config?.txid, network: config?.network });
        // 服务费
        this.serviceFee = Number(process.env.SERVICEFEE)
        // 流动性提供者费用
        this.lpFee = Number(process.env.LPFEE)
        // 手续费因子
        this.feeFactor = Number(process.env.FEEFACTOR)
        // 交易手续费
        this.tradeFee = Number(process.env.TRADEFEE)
        // utxo 手续费
        this.fee = Number(process.env.FEE)
        this.address_buy = config.address_buy_sell;
        this.private_buy = tbc.PrivateKey.fromString(config.private_buy_sell);

        this.address_sell = config.address_buy_sell;
        this.private_sell = tbc.PrivateKey.fromString(config.private_buy_sell);

        this.buys = [];
        this.sells = [];
        this.lpPlan = config.lpPlan;
        this.ft_contract_id = config.ft_contract_id;

        this.periodicTime = Number(process.env.PERIODICTIME)
        this.trade_timeout = Number(process.env.TRADE_TIMEOUT)
    }

    async initfromContractId(retryCount = 8) {
        try {
            await super.initfromContractId();
        } catch (error) {
            if (retryCount > 0) {
                logWarnWithTimestamp(`Retrying initfromContractId (${8 - retryCount} attempt(s) failed)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.initfromContractId(retryCount - 1);
            } else {
                logErrWithTimestamp(`Failed to initfromContractId after multiple attempts: ${error.message}`);
                throw new Error("Failed to initfromContractId after retries.");
            }
        }
    }

    async boot() {
        this.runPeriodicTask().catch(error => {
            logErrWithTimestamp('Top-level error:', error);
        });
        // setInterval(async () => {
        //     try {
        //         if (this.buys.length > 0) {
        //             await this.processBuyData();
        //             return
        //         }
        //         if (this.sells.length > 0) {
        //             await this.processSellData();
        //         }
        //     } catch (error) {
        //         logInfoWithTimestamp(error)
        //     }
        //
        // }, 3000);
    }

    async performTask() {
        try {
            if (this.buys.length > 0) {
                this.initfromContractId()
                await this.processBuyData();
                return
            }
            if (this.sells.length > 0) {
                this.initfromContractId()
                await this.processSellData();
            }
        } catch (error) {
            logInfoWithTimestamp(error)
        }
    }

    async runPeriodicTask() {
        while (true) {
            // logInfoWithTimestamp(`Waiting for ${this.periodicTime} ms before next execution: ${this.contractTxid} ${new Date()}`);
            await this.performTask();
            await new Promise((resolve) => setTimeout(resolve, this.periodicTime));
        }
    }

    async swaptoTokens(hash, address_to, amount_tbc, slide = 0) {
        try {
            const amount_ft = await this.getSwaptoToken(amount_tbc*(1000-this.tradeFee)/1000)
            this.buys.push([address_to, amount_tbc*(1000-this.tradeFee)/1000, amount_ft*(1000-slide)/1000, slide, hash]);
        } finally {
        }
    }

    async processBuyData(){
        const dataToProcess = [...this.buys];
        this.buys.length = 0;
        logInfoWithTimestamp(`processBuyData before: ${dataToProcess}`)
        var beyondSlideArray = [];
        let sum = dataToProcess.reduce((total, item) => total + item[1], 0).toFixed(6);
        // 获取可兑换的代币数量
        let ft_amount = await this.getSwaptoToken(sum)
        logInfoWithTimestamp(`sum and ft_amount: ${sum}, ${ft_amount}`)
        // 过滤超出滑点的情况
        for(let i = 0; i < dataToProcess.length; i++) {
            if(dataToProcess[i][1]*ft_amount/sum < dataToProcess[i][2] * (1 - dataToProcess[i][3]/100) && dataToProcess[i][3] > 0) {
                beyondSlideArray.push(dataToProcess[i])
                dataToProcess.splice(i,1)
                i--;
            }
        }
        logInfoWithTimestamp('Beyond the sliding point: ', beyondSlideArray)
        logInfoWithTimestamp(`processBuyData after: ${dataToProcess}`)
        // 处理超出滑点的订单退款
        if(beyondSlideArray.length > 0) {
            logInfoWithTimestamp(beyondSlideArray.map(([addr]) => addr),beyondSlideArray.map(([description, amount]) => parseFloat(this.truncateDecimals(amount, 6))))
            await this.transferTBC_toClient(this.private_buy, beyondSlideArray.map(([addr]) => addr), beyondSlideArray.map(([description, amount]) => this.truncateDecimals(amount, 6)))
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        if(dataToProcess.length == 0) {
            return
        }
        // 计算总交易量，创建交易记录
        sum = dataToProcess.reduce((total, item) => total + item[1], 0);
        ft_amount = await this.getSwaptoToken(sum)
        logInfoWithTimestamp('sum and ft_amount after slide refund:', sum, ft_amount)
        await FTPrice.create({
            ft: this.ft_a_contractTxid,
            kind: '1',
            ft_amount: ft_amount,
            tbc_amout: sum,
            price: ft_amount/sum
        })
        const trade = await BuyTrade.create({
            buys: dataToProcess.map(([address, amount, slideAmount, slide, hash]) => ({
                address,
                amount,
                slideAmount,
                slide,
                hash,
            })),
            tbc_total: sum,
            ft_total: ft_amount,
            ft_contract_id: this.ft_contract_id
        });
        // 执行代币交换， 买比卖多才执行merge
        let txraw
        logInfoWithTimestamp(this.private_buy, sum + this.fee, this.network)
        try{
            await new Promise(resolve => setTimeout(resolve, this.trade_timeout));
            const utxo = await API.fetchUTXO(this.private_buy, sum + this.fee, this.network);
            logInfoWithTimestamp('utxo:', utxo)
            txraw = await this.swaptoToken_baseTBC(this.private_buy, this.address_buy, utxo, parseFloat(this.truncateDecimals(sum, 6)), this.lpPlan)
        } catch (error) {
            if (error.message.includes('Insufficient PoolFT, please merge FT UTXOs')) {
                try {
                    //await this.mergeFTResponse();
                    await this.poolNFTMergeResponse(10);
                } catch (err) {
                    throw new Error(err);
                }
            } else {
                throw new Error(error.message);
            }
        }
        // 如果交易失败，尝试重新执行
        if (txraw.length === 0) {
            logInfoWithTimestamp('txraw try again')
            await new Promise(resolve => setTimeout(resolve, this.trade_timeout));
            await this.initfromContractId()
            const utxo = await API.fetchUTXO(this.private_buy, sum + this.fee, this.network);
            txraw = await this.swaptoToken_baseTBC(this.private_buy, this.address_buy, utxo, parseFloat(this.truncateDecimals(sum, 6)), this.lpPlan)
        }
        const raw = await API.broadcastTXraw(txraw, this.network)

        await BuyTrade.findByIdAndUpdate(
            trade._id,
            { raw: raw },
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
        // 处理每个订单的代币转账
        const Token = new FT(this.ft_a_contractTxid);
        const TokenInfo = await API.fetchFtInfo(Token.contractTxid, this.network);
        await Token.initialize(TokenInfo);
        for (const [address, amount, slideAmount, slide, hash] of dataToProcess) {
            logInfoWithTimestamp(`Description: ${address}, Amount: ${amount}, FT: ${parseFloat(this.truncateDecimals(amount*ft_amount/sum, 6))}`);
            // 准备utxo
            const utxo = await API.fetchUTXO(this.private_buy, 0.01, this.network);
            const addressFtBanalce = await API.getFTbalance(Token.contractTxid, this.address_buy, this.network)
            let transferTokenAmountBN = BigInt(Math.ceil(amount*ft_amount/sum * Math.pow(10, Token.decimal)));
            
            logInfoWithTimestamp('transferTokenAmountBN: ', transferTokenAmountBN)
            logInfoWithTimestamp('addressFtBanalce', addressFtBanalce)
            if (BigInt(addressFtBanalce) < transferTokenAmountBN) {
                transferTokenAmountBN = BigInt(addressFtBanalce)
            }
            // 准备FT TUXO
            const ftutxo_codeScript = FT.buildFTtransferCode(Token.codeScript, this.address_buy).toBuffer().toString('hex');
            const ftutxos = await API.fetchFtUTXOs(Token.contractTxid, this.address_buy, ftutxo_codeScript, this.network, transferTokenAmountBN);
            logInfoWithTimestamp('ftutxos', ftutxos)
            // 准备交易数据
            let preTXs = [];
            let prepreTxDatas = [];
            for (let i = 0; i < ftutxos.length; i++) {
                preTXs.push(await API.fetchTXraw(ftutxos[i].txId, this.network));
                prepreTxDatas.push(await API.fetchFtPrePreTxData(preTXs[i], ftutxos[i].outputIndex, this.network));
            }
            // const mergeTX = Token.mergeFT(this.private_buy, ftutxos, utxo, preTXs, prepreTxDatas);
            // if (typeof mergeTX === 'string') {
            //     await API.broadcastTXraw(mergeTX, network);
            //     await new Promise(resolve => setTimeout(resolve, 5000))
            // } else {
            //     logInfoWithTimestamp("Merge success");
            // }

            // 执行转账
            const transferTX = Token.transfer(this.private_buy, address, parseFloat(this.truncateDecimals(amount*ft_amount/sum, 6)), ftutxos, utxo, preTXs, prepreTxDatas);
            const tx = await API.broadcastTXraw(transferTX, this.network);
            // 更新交易记录
            const result = await BuyTrade.findOneAndUpdate(
                { 'buys.hash': hash }, // 查询条件
                { $set: { 'buys.$[].tx': tx, 'buys.$[].ft_amount': parseFloat(this.truncateDecimals(amount*ft_amount/sum, 6))}}
            );
            if (!result) {
                logInfoWithTimestamp("No document in BuyTrade.");
            } else {
                logInfoWithTimestamp("Updated BuyTrade success");
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    async getSwaptoToken(amount_tbc) {
        amount_tbc = parseFloat(this.truncateDecimals(amount_tbc, 6))
        const FTA = new FT(this.ft_a_contractTxid);
        const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);
        await FTA.initialize(FTAInfo);

        // 计算手续费
        const amount_tbcbn = 
            BigInt(amount_tbc * Math.pow(10, 6)) *
            BigInt(this.feeFactor - (this.serviceFee + this.lpFee)) / BigInt(this.feeFactor);
        
        logInfoWithTimestamp('getSwaptoToken:', this.tbc_amount, amount_tbcbn);
        // if (this.tbc_amount < amount_tbcbn) {
        //     throw new Error('Invalid tbc amount input');
        // }
        const poolMul = this.ft_a_amount * this.tbc_amount;
        const tbc_amount = BigInt(this.tbc_amount) + BigInt(amount_tbcbn);
        const ft_a_amount = BigInt(poolMul) / BigInt(tbc_amount);
        const ft_a_amount_decrement = BigInt(this.ft_a_amount) - BigInt(ft_a_amount);
        // if (this.ft_a_amount < ft_a_amount_decrement) {
        //     throw new Error('Invalid FT amount input');
        // }
        return Number(ft_a_amount_decrement)/Math.pow(10, FTA.decimal);
    }

    async swaptoTBCs(hash, address_to, amount_token, slide = 0) {
        try {
            const amount_tbc = await this.getSwaptoTBC(amount_token)
            this.sells.push([address_to, amount_token, amount_tbc*(1000-slide)/1000, slide, hash]);
        } finally {
        }
    }

    async processSellData() {
        const dataToProcess = [...this.sells];
        this.sells.length = 0;
        logInfoWithTimestamp(`processSellData before: ${dataToProcess}`)
        let beyondSlideArray = [];
        let sum = dataToProcess.reduce((total, item) => total + item[1], 0).toFixed(6);
        // 获取可兑换的tbc数量
        let tbc_amount = await this.getSwaptoTBC(sum)
        logInfoWithTimestamp(`sum and tbc_amount: ${sum}, ${tbc_amount}`)
        // 过滤超出滑点的情况
        for(let i = 0; i < dataToProcess.length; i++) {
            if(dataToProcess[i][1]*tbc_amount/sum < dataToProcess[i][2] * (1 - dataToProcess[i][3]/100) && dataToProcess[i][3] > 0) {
                beyondSlideArray.push(dataToProcess[i])
                dataToProcess.splice(i,1)
                i--;
            }
        }
        logInfoWithTimestamp('Beyond the sliding point: ', beyondSlideArray)
        logInfoWithTimestamp(`processSellData after: ${dataToProcess}`)
        // 处理超出滑点的订单退款
        if(beyondSlideArray.length > 0) {
            logInfoWithTimestamp(beyondSlideArray.map(([addr]) => addr),beyondSlideArray.map(([description, amount]) => parseFloat(this.truncateDecimals(amount, 6))))
            const Token = new FT(this.ft_a_contractTxid);
            const TokenInfo = await API.fetchFtInfo(Token.contractTxid, this.network);
            await Token.initialize(TokenInfo);
            for(let i = 0; i < beyondSlideArray.length; i++) {
                const utxo = await API.fetchUTXO(this.private_sell, 0.01, this.network);//准备utxo
                const transferTokenAmountBN = BigInt(beyondSlideArray[i][1] * Math.pow(10, Token.decimal));
                const ftutxo_codeScript = FT.buildFTtransferCode(Token.codeScript, this.address_sell).toBuffer().toString('hex');
                const ftutxos = await API.fetchFtUTXOs(Token.contractTxid, this.address_sell, ftutxo_codeScript, this.network, transferTokenAmountBN);//准备ft utxo
                logInfoWithTimestamp('ftutxos slide refund: ', ftutxos)
                let preTXs = [];
                let prepreTxDatas = [];
                for (let i = 0; i < ftutxos.length; i++) {
                    preTXs.push(await API.fetchTXraw(ftutxos[i].txId, this.network));
                    prepreTxDatas.push(await API.fetchFtPrePreTxData(preTXs[i], ftutxos[i].outputIndex, this.network));
                }
                const transferTX = Token.transfer(this.private_sell, beyondSlideArray[i][0], beyondSlideArray[i][1], ftutxos, utxo, preTXs, prepreTxDatas);//组装交易
                await API.broadcastTXraw(transferTX, this.network);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        if(dataToProcess.length == 0) {
            return
        }
        // 计算总交易量，创建交易记录
        sum = dataToProcess.reduce((total, item) => total + item[1], 0);
        tbc_amount = await this.getSwaptoTBC(sum)
        logInfoWithTimestamp('sum and tbc_amount after slide refund:', sum, tbc_amount)
        await FTPrice.create({
            ft: this.ft_a_contractTxid,
            kind: '2',
            ft_amount: sum,
            tbc_amout: tbc_amount,
            price: sum/tbc_amount
        })
        const trade = await SellTrade.create({
            sells: dataToProcess.map(([address, amount, slideAmount, slide, hash]) => ({
                address,
                amount,
                slideAmount,
                slide,
                hash
            })),
            ft_total: sum,
            tbc_total: tbc_amount*(1000-this.tradeFee)/1000,
            ft_contract_id: this.ft_contract_id
        })
        // 执行代币交换
        let txraw
        try{
            await new Promise(resolve => setTimeout(resolve, this.trade_timeout));
            const utxo = await API.fetchUTXO(this.private_sell, this.fee, this.network);
            logInfoWithTimestamp('utxo:', utxo)
            txraw = await this.swaptoTBC_baseToken(this.private_sell, this.address_sell, utxo, sum, this.lpPlan)
        } catch (error) {
            if (error.message.includes('Insufficient PoolTbc, please merge FT UTXOs')) {
                try {
                    await this.poolNFTMergeResponse(10);
                } catch (err) {
                    throw new Error(err);
                }
            } else if (error.message.includes('Insufficient FTbalance, please merge FT UTXOs')) {
                try {
                    await this.mergeFTResponse();
                } catch (err) {
                    throw new Error(err);
                }
            } else {
                throw new Error(error.message);
            }
        }
        // 如果交易失败，尝试重新执行
        if (txraw === undefined) {
            try{
                await new Promise(resolve => setTimeout(resolve, this.trade_timeout));
                await this.initfromContractId()
                const utxo = await API.fetchUTXO(this.private_sell, this.fee, this.network);
                logInfoWithTimestamp('utxo try again: ', utxo)
                txraw = await this.swaptoTBC_baseToken(this.private_sell, this.address_sell, utxo, sum, this.lpPlan)
            } catch (error) {
                if (error.message.includes('Insufficient PoolTbc, please merge FT UTXOs')) {
                    try {
                        await this.poolNFTMergeResponse(10);
                    } catch (err) {
                        throw new Error(err);
                    }
                } else if (error.message.includes('Insufficient FTbalance, please merge FT UTXOs')) {
                    try {
                        await this.mergeFTResponse();
                    } catch (err) {
                        throw new Error(err);
                    }
                } else {
                    throw new Error(error.message);
                }
            }
        }
        // 如果交易失败，尝试重新执行
        if (txraw === undefined) {
            await new Promise(resolve => setTimeout(resolve, this.trade_timeout));
            await this.initfromContractId()
            const utxo = await API.fetchUTXO(this.private_sell, this.fee, this.network);
            logInfoWithTimestamp('utxo try again again: ', utxo)
            txraw = await this.swaptoTBC_baseToken(this.private_sell, this.address_sell, utxo, sum, this.lpPlan)
        }
        const raw = await API.broadcastTXraw(txraw, this.network)
        await SellTrade.findByIdAndUpdate(
            trade._id,
            { raw: raw },
        );
        await new Promise(resolve => setTimeout(resolve, 8000));
        // 处理每个订单的tbc转账
        const tbc_amount_real = tbc_amount*(1000-this.tradeFee)/1000;
        logInfoWithTimestamp(`tbc_amount_real: ${tbc_amount_real}`)
        const tx = await this.transferTBC_toClient(this.private_sell, dataToProcess.map(([addr]) => addr), dataToProcess.map(([description, amount]) => this.truncateDecimals(tbc_amount_real*amount/sum, 6)))
        for (const [address, amount, slideAmount, slide, hash] of dataToProcess) {
            const result = await SellTrade.findOneAndUpdate(
                { 'sells.hash': hash }, // 查询条件
                { $set: { 'sells.$[].tx': tx, 'sells.$[].tbc_amount': tbc_amount_real*amount/sum}}
            );
            if (!result) {
                logInfoWithTimestamp("No document in SellTrade.");
            } else {
                logInfoWithTimestamp("Updated SellTrades success");
            }
        }
    }

    async transferTBC_toClient(privateKey, address_to, amount) {
        let totalAmount = 0;
        let amount_bn = [];
        for (let i = 0; i < address_to.length; i++) {
            amount_bn.push(Math.ceil(amount[i] * Math.pow(10, 6)));
            totalAmount += amount[i];
        }
        const utxo = await API.fetchUTXO(privateKey, totalAmount + 0.001, this.network);
        const tx = new tbc.Transaction()
            .from(utxo)
        for (let i = 0; i < address_to.length; i++) {
            tx.to(address_to[i], amount_bn[i]);
        }
        tx.change(privateKey.toAddress());
        const txSize = tx.getEstimateSize();
        if (txSize < 1000) {
            tx.fee(80);
        } else {
            tx.feePerKb(100);
        }
        tx.sign(privateKey);
        tx.seal();
        const txraw = tx.uncheckedSerialize();
        return API.broadcastTXraw(txraw, this.network)
    }

    async getSwaptoTBC(amount_token) {
        const FTA = new FT(this.ft_a_contractTxid);
        const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);
        await FTA.initialize(FTAInfo);

        // 计算手续费
        const amount_ftbn =
            BigInt(amount_token * Math.pow(10, FTA.decimal)) *
            BigInt(this.feeFactor - (this.serviceFee + this.lpFee)) / BigInt(this.feeFactor);

        logInfoWithTimestamp('getSwaptoTBC:', this.ft_a_amount, amount_ftbn);
        // if (this.ft_a_amount < amount_ftbn) {
        //     throw new Error('Invalid FT-A amount input');
        // }
        const poolMul = this.ft_a_amount * this.tbc_amount;
        const ft_a_amount = BigInt(this.ft_a_amount) + BigInt(amount_ftbn);
        const tbc_amount = BigInt(poolMul) / ft_a_amount;
        const tbc_amount_decrement = BigInt(this.tbc_amount) - BigInt(tbc_amount);
        return Number(tbc_amount_decrement)/Math.pow(10, 6);
    }

    async mergeFTResponse() {
        try {
            this.initfromContractId()
            const Token = new FT(this.ft_a_contractTxid);
            const TokenInfo = await API.fetchFtInfo(Token.contractTxid, this.network); //获取FT信息
            Token.initialize(TokenInfo);
            const ftutxo_codeScript = FT.buildFTtransferCode(Token.codeScript, this.address_sell)
                .toBuffer()
                .toString('hex');

            let txids = [];
            for (let i = 0; i < 10; i++) {
                const utxo = await API.fetchUTXO(this.private_sell, this.fee, this.network);
                const ftutxos = await API.fetchFtUTXOs(
                    Token.contractTxid,
                    this.address_sell,
                    ftutxo_codeScript,
                    this.network
                );
                let preTXs = [];
                let prepreTxDatas = [];
                for (let i = 0; i < ftutxos.length; i++) {
                    preTXs.push(await API.fetchTXraw(ftutxos[i].txId, this.network)); //获取每个ft输入的父交易
                    prepreTxDatas.push(await API.fetchFtPrePreTxData(preTXs[i], ftutxos[i].outputIndex, this.network)); //获取每个ft输入的爷交易
                }
                const txHex = Token.mergeFT(this.private_sell, ftutxos, utxo, preTXs, prepreTxDatas);
                if (txHex === true) break;
                const { txid } = await API.broadcastTXraw(txHex, this.network);
                if (!txid) {
                    throw new Error('Failed to broadcast transaction!');
                }
                txids[i] = txid;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            return txids.join(', ');
        } catch (error) {
            logErrWithTimestamp('Merge failed:', error);
            //logInfoWithTimestamp('error:',error);
            return error.message;
        }
    }

    async poolNFTMergeResponse(merge_times) {
        try {
            await this.initfromContractId()
            let txids  = [];
            for (let i = 0; i < merge_times; i++) {
                const utxo = await API.fetchUTXO(this.private_sell, this.fee, this.network);
                const txHex = await this.mergeFTinPool(this.private_sell, utxo);
                logInfoWithTimestamp('txHex:', txHex)
                if (txHex === true) break;
                const txid = await API.broadcastTXraw(txHex, this.network);
                logInfoWithTimestamp(txid)
                if (i < merge_times - 1) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

            return txids.join(', ')
        } catch (error) {
            logErrWithTimestamp('Merge failed:', error);
            //logInfoWithTimestamp('error:',error);
            return error.message;
        }
    }

    async getFTTX(txid, retryCount = 8) {
        const url_testnet = `https://tbcdev.org/v1/tbc/main/ft/decode/tx/history/${txid}`;
        const url_mainnet = `https://turingwallet.xyz/v1/tbc/main/ft/decode/tx/history/${txid}`;
        let url = url_testnet;
        if (this.network === "testnet") {
            url = url_testnet
        } else if (this.network === "mainnet") {
            url = url_mainnet
        }
        try {
            const response = await (await fetch(url)).json();
            let data = response;
            const FTA = new FT(this.ft_a_contractTxid);
            const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);//获取FT信息
            FTA.initialize(FTAInfo);
            if (data.output[0].address == this.address_sell && data.output[0].contract_id == this.ft_a_contractTxid) {
                return Number(data.output[0].ft_balance/Math.pow(10, FTA.decimal))
            } else if (data.output[1].address == this.address_sell && data.output[1].contract_id == this.ft_a_contractTxid) {
                return Number(data.output[0].ft_balance/Math.pow(10, FTA.decimal))
            }
            return new Error("tx error");
        } catch (error) {
            if (retryCount > 0) {
                logWarnWithTimestamp(`Retrying getFTTX for txid ${txid} (${8 - retryCount} attempt(s) failed)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.getFTTX(txid, retryCount - 1); // 递归调用进行重试
            } else {
                logErrWithTimestamp(`Failed to fetch data after multiple attempts: ${error.message}`);
                throw new Error("Failed to fetch PoolNFTInfo after retries.");
            }
        }
    }

    async getTBCTX(txid, retryCount = 8) {
        const url_testnet = `https://tbcdev.org/v1/tbc/main/tx/hex/${txid}/decode`;
        const url_mainnet = `https://turingwallet.xyz/v1/tbc/main/tx/hex/${txid}/decode`;
        let url = url_testnet;
        if (this.network === "testnet") {
            url = url_testnet
        } else if (this.network === "mainnet") {
            url = url_mainnet
        }
        try {
            const response = await (await fetch(url)).json();
            let data = response;
            if (data.vout[0].scriptPubKey.addresses.includes(this.address_buy)) {
                return data.vout[0].value
            } else if (data.vout[1].scriptPubKey.addresses.includes(this.address_buy)) {
                return data.vout[1].value
            }
            return new Error("tx error");
        } catch (error) {
            if (retryCount > 0) {
                logWarnWithTimestamp(`Retrying getFTTX for txid ${txid} (${8 - retryCount} attempt(s) failed)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.getTBCTX(txid, retryCount - 1); // 递归调用进行重试
            } else {
                logErrWithTimestamp(`Failed to fetch data after multiple attempts: ${error.message}`);
                throw new Error("Failed to fetch PoolNFTInfo after retries.");
            }
        }
    }

    truncateDecimals(value, decimals) {
        if (typeof value !== 'number') value = parseFloat(value);
        if (isNaN(value)) return NaN;
      
        const factor = Math.pow(10, decimals);
        return Math.floor(value * factor) / factor;
    }
}


exports.poolEx = poolEx;
