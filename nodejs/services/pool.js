const tbc = require("tbc-lib-js");
const { API, FT, poolNFT } = require("tbc-contract");
const {PrivateKey} = require("tbc-lib-js");
const {BuyTrade} = require('../model/BuyTrade');
const {SellTrade} = require('../model/SellTrade');
const {FTPrice} = require('../model/FTPrice');


class poolF extends  poolNFT {

    constructor(config = {}) {
        super(config);
    }

    async getSwaptoToken(amount_tbc) {
        const FTA = new FT(this.ft_a_contractTxid);
        const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);
        await FTA.initialize(FTAInfo);

        const amount_tbcbn = BigInt(amount_tbc * Math.pow(10, 6));
        if (this.tbc_amount < amount_tbcbn) {
            console.log(this.tbc_amount, amount_tbcbn);
            throw new Error('Invalid tbc amount input');
        }
        const poolMul = this.ft_a_amount * this.tbc_amount;
        const tbc_amount = BigInt(this.tbc_amount) + BigInt(amount_tbcbn);
        const ft_a_amount = BigInt(poolMul) / BigInt(tbc_amount);
        const ft_a_amount_decrement = BigInt(this.ft_a_amount) - BigInt(ft_a_amount);
        if (this.ft_a_amount < ft_a_amount_decrement) {
            throw new Error('Invalid FT amount input');
        }
        return Number(ft_a_amount_decrement)/Math.pow(10, FTA.decimal);
    }

    async getSwaptoTokenEx(amount_token) {
        const FTA = new FT(this.ft_a_contractTxid);
        const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);
        await FTA.initialize(FTAInfo);
        const amount_ftbn = BigInt(amount_token * Math.pow(10, FTA.decimal));
        if (this.ft_a_amount < amount_ftbn) {
            throw new Error('Invalid FT-A amount input');
        }
        const poolMul = this.ft_a_amount * this.tbc_amount;
        const ft_a_amount = BigInt(this.ft_a_amount) - BigInt(amount_ftbn);
        const tbc_amount = BigInt(poolMul) / ft_a_amount;
        const tbc_amount_decrement = BigInt(tbc_amount) - BigInt(this.tbc_amount);
        return Number(tbc_amount_decrement)/Math.pow(10, 6);
    }

    async getSwaptoTBC(amount_token) {
        const FTA = new FT(this.ft_a_contractTxid);
        const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);
        await FTA.initialize(FTAInfo);
        const amount_ftbn = BigInt(amount_token * Math.pow(10, FTA.decimal));
        if (this.ft_a_amount < amount_ftbn) {
            throw new Error('Invalid FT-A amount input');
        }
        const poolMul = this.ft_a_amount * this.tbc_amount;
        const ft_a_amount = BigInt(this.ft_a_amount) + BigInt(amount_ftbn);
        const tbc_amount = BigInt(poolMul) / ft_a_amount;
        const tbc_amount_decrement = BigInt(this.tbc_amount) - BigInt(tbc_amount);
        return Number(tbc_amount_decrement)/Math.pow(10, 6);
    }

    async getSwaptoTbcEx(amount_tbc) {
        const FTA = new FT(this.ft_a_contractTxid);
        const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);
        await FTA.initialize(FTAInfo);

        const amount_tbcbn = BigInt(amount_tbc * Math.pow(10, 6));
        if (this.tbc_amount < amount_tbcbn) {
            console.log(this.tbc_amount, amount_tbcbn);
            throw new Error('Invalid tbc amount input');
        }
        const poolMul = this.ft_a_amount * this.tbc_amount;
        const tbc_amount = BigInt(this.tbc_amount) - BigInt(amount_tbcbn);
        const ft_a_amount = BigInt(poolMul) / BigInt(tbc_amount);
        const ft_a_amount_decrement = BigInt(ft_a_amount) - BigInt(this.ft_a_amount);
        if (this.ft_a_amount < ft_a_amount_decrement) {
            throw new Error('Invalid FT amount input');
        }
        return Number(ft_a_amount_decrement)/Math.pow(10, FTA.decimal);
    }

    getPool() {
        const tbc_amount = this.tbc_amount
        const ft_a_amount = this.ft_a_amount;
        const ft_lp_amount = this.ft_lp_amount;
        return {tbc_amount, ft_a_amount, ft_lp_amount}
    }

    async getConsumLP(amount_lp) {
        const lpAmount = BigInt(amount_lp * Math.pow(10, 6));
        const factor = BigInt(10 ** 6);
        if (lpAmount == BigInt(0)) {
            return { tbc_amount: 0, ft_a_amount: 0, ft_lp_amount: 0 };
        } else if (lpAmount > BigInt(0) && lpAmount <= BigInt(this.ft_lp_amount)) {
            const ratio = BigInt(this.ft_lp_amount) * factor / lpAmount;
            const ft_lp_amount =  lpAmount;
            const ft_a_amount = factor* BigInt(this.ft_a_amount) / ratio;
            const tbc_amount =  factor* BigInt(this.tbc_amount) / ratio;
            return {tbc_amount, ft_a_amount, ft_lp_amount}
        } else {
            throw new Error("lp is invalid!")
        }
    }

    async getLPBalance(address) {
        const FTA = new FT(this.ft_a_contractTxid);
        const FTAInfo = await API.fetchFtInfo(FTA.contractTxid, this.network);
        FTA.initialize(FTAInfo);
        const ftlpCode = this.getFTLPcode(tbc.crypto.Hash.sha256(Buffer.from(this.poolnft_code,'hex')).toString('hex'), address, FTA.tapeScript.length / 2).toBuffer().toString('hex');
        const ftlpBalance = await this.fetchFtlpBalance(ftlpCode);
        return ftlpBalance
    }

    async fetchFtlpBalance(ftlpCode) {
        const ftlpHash = tbc.crypto.Hash.sha256(Buffer.from(ftlpCode, 'hex')).reverse().toString('hex');
        const url_testnet = `http://tbcdev.org:5000/v1/tbc/main/ft/lp/unspent/by/script/hash${ftlpHash}`;
        const url_mainnet = `https://turingwallet.xyz/v1/tbc/main/ft/lp/unspent/by/script/hash${ftlpHash}`;
        let url = url_testnet;
        if (this.network === "testnet") {
            url = url_testnet
        } else if (this.network === "mainnet") {
            url = url_mainnet
        }
        try {
            const response = await (await fetch(url)).json();
            let balance = BigInt(0);
            for (let i = 0; i < response.ftUtxoList.length; i++) {
                balance += BigInt(response.ftUtxoList[i].ftBalance);
            }
            return balance;
        } catch (error) {
            throw new Error("Failed to fetch FTLP Balance.");
        }
    }

}

exports.poolF = poolF;